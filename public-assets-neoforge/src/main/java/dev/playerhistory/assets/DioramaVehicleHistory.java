package dev.playerhistory.assets;

import dev.playerhistory.core.LogSink;
import dev.playerhistory.object.ObjectHistoryApi;
import dev.playerhistory.object.ObjectSnapshot;
import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/** Consumes Diorama's published snapshot; never re-enumerates or captures vehicles. */
final class DioramaVehicleHistory {
  private final LogSink log;
  private Method latest;
  private boolean absent;
  private long last;
  private volatile long generation;
  private final Set<String> archived = ConcurrentHashMap.newKeySet();
  private final Set<String> pending = ConcurrentHashMap.newKeySet();
  private final ExecutorService writer = Executors.newSingleThreadExecutor(task -> {
    Thread thread = new Thread(task,"Diorama vehicle history archive");thread.setDaemon(true);thread.setPriority(Thread.MIN_PRIORITY);return thread;
  });
  DioramaVehicleHistory(LogSink log) {this.log=log;}
  private static Object value(Object record,String name) throws ReflectiveOperationException {return record.getClass().getMethod(name).invoke(record);}
  private static double number(Object record,String name) throws ReflectiveOperationException {return ((Number)value(record,name)).doubleValue();}
  void tick(ServerTickEvent.Post event) {
    if(absent || !ObjectHistoryApi.available())return;
    try {
      if(latest==null)latest=Class.forName("dev.diorama.api.WebVehicleScene").getMethod("latest");
      Object snapshot=latest.invoke(null);long time=((Number)value(snapshot,"time")).longValue();
      if(time<=last || System.currentTimeMillis()-time>15000)return;
      last=time;
      Map<String,List<ObjectSnapshot>> providers=new LinkedHashMap<>();
      providers.put("create_contraptions",new ArrayList<>());providers.put("sable_ships",new ArrayList<>());
      for(Object row:(List<?>)value(snapshot,"vehicles")) {
        String provider=(String)value(row,"provider"),source=(String)value(row,"sourceId");
        long version=((Number)value(row,"version")).longValue();
        providers.computeIfAbsent(provider,ignored->new ArrayList<>()).add(new ObjectSnapshot(source,(String)value(row,"label"),(String)value(row,"dimension"),
          number(row,"x"),number(row,"y"),number(row,"z"),(float)number(row,"qx"),(float)number(row,"qy"),(float)number(row,"qz"),(float)number(row,"qw"),1,1,1,version,List.of()));
        archive(provider,source,version,(Path)value(row,"sprite"),(Path)value(row,"atlas"));
      }
      providers.forEach((provider,rows)->ObjectHistoryApi.providerSnapshot(provider,rows,time));
    } catch(ClassNotFoundException ignored) {absent=true;}
    catch(ReflectiveOperationException|RuntimeException error){log.warn("Cannot consume Diorama vehicle publication: "+error);}
  }
  private void archive(String provider,String source,long version,Path sprite,Path atlas) {
    String key=provider+"/"+source+"/"+version;
    long session = generation;
    String pendingKey = session + "/" + key;
    if(archived.contains(key)||pending.size()>=64||!pending.add(pendingKey))return;
    Object recorderSession = ObjectHistoryApi.session();
    writer.execute(()->{
      if (session != generation) {pending.remove(pendingKey);return;}
      try {
        boolean copied = ObjectHistoryApi.archiveGeometryInSession(recorderSession,provider,source,version,sprite,atlas);
        if (copied && session == generation) {archived.add(key);if(archived.size()>2048)archived.clear();}
      }
      catch(java.io.IOException|RuntimeException error){log.warn("Cannot archive Diorama craft sprite: "+error);}
      finally {pending.remove(pendingKey);}
    });
  }
  void stop(ServerStoppingEvent event) {generation++;last=0;archived.clear();pending.clear();}
}
