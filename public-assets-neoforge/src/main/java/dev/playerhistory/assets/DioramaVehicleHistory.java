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
  private Method historyEnabled;
  private Method historyInterval;
  private boolean absent;
  private long last;
  private long nextSample;
  private int sampleInterval = 500;
  private boolean recording = true;
  private final java.util.function.LongSupplier clock;
  private volatile long generation;
  private final Set<String> archived = Collections.synchronizedSet(new LinkedHashSet<>());
  private final Set<String> pending = ConcurrentHashMap.newKeySet();
  private final ExecutorService writer = Executors.newSingleThreadExecutor(task -> {
    Thread thread = new Thread(task,"Diorama vehicle history archive");thread.setDaemon(true);thread.setPriority(Thread.MIN_PRIORITY);return thread;
  });
  DioramaVehicleHistory(LogSink log) {this(log, System::currentTimeMillis);}
  DioramaVehicleHistory(LogSink log, java.util.function.LongSupplier clock) {this.log=log;this.clock=clock;}
  private static Object value(Object record,String name) throws ReflectiveOperationException {return record.getClass().getMethod(name).invoke(record);}
  private static double number(Object record,String name) throws ReflectiveOperationException {return ((Number)value(record,name)).doubleValue();}
  void tick(ServerTickEvent.Post event) {
    sample();
  }
  void sample() {
    if(absent || !ObjectHistoryApi.available())return;
    try {
      if(latest==null) {
        Class<?> scene = Class.forName("dev.diorama.api.WebVehicleScene");
        latest = scene.getMethod("latest");
        try {
          historyEnabled = scene.getMethod("historyEnabled");
          historyInterval = scene.getMethod("historyIntervalMs");
        } catch (NoSuchMethodException ignored) { /* Older Diorama keeps the default policy. */ }
      }
      boolean enabled = historyEnabled == null || Boolean.TRUE.equals(historyEnabled.invoke(null));
      if (!enabled) {
        if (recording) {
          reset();
          long now = clock.getAsLong();
          for (String provider : List.of("create_trains", "create_contraptions", "sable_ships"))
            ObjectHistoryApi.providerSnapshot(provider, List.of(), now);
          recording = false;
        }
        return;
      }
      recording = true;
      long now = clock.getAsLong();
      int interval = historyInterval == null ? 500 : ((Number) historyInterval.invoke(null)).intValue();
      interval = Math.max(100, Math.min(60000, interval));
      if (interval != sampleInterval) { sampleInterval = interval; nextSample = 0; }
      if (now < nextSample) return;
      nextSample = now + interval;
      Object snapshot=latest.invoke(null);long time=((Number)value(snapshot,"time")).longValue();
      if(time<=last || now-time>15000)return;
      last=time;
      Map<String,List<ObjectSnapshot>> providers=new LinkedHashMap<>();
      providers.put("create_trains",new ArrayList<>());providers.put("create_contraptions",new ArrayList<>());providers.put("sable_ships",new ArrayList<>());
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
    if(hasArchive(key)||pending.size()>=64||!pending.add(pendingKey))return;
    Object recorderSession = ObjectHistoryApi.session();
    writer.execute(()->{
      if (session != generation) {pending.remove(pendingKey);return;}
      try {
        boolean copied = ObjectHistoryApi.archiveGeometryInSession(recorderSession,provider,source,version,sprite,atlas);
        if (copied && session == generation) {
          rememberArchive(key);
        }
      }
      catch(java.io.IOException|RuntimeException error){log.warn("Cannot archive Diorama craft sprite: "+error);}
      finally {pending.remove(pendingKey);}
    });
  }
  boolean hasArchive(String key) {
    synchronized (archived) {
      if (!archived.remove(key)) return false;
      archived.add(key);
      return true;
    }
  }
  void rememberArchive(String key) {
    synchronized (archived) {
      archived.remove(key);
      archived.add(key);
      if (archived.size() > 2048) {
        var oldest = archived.iterator(); oldest.next(); oldest.remove();
      }
    }
  }
  void reset() {generation++;last=0;nextSample=0;archived.clear();pending.clear();}
  void stop(ServerStoppingEvent event) {reset();recording=true;}
}
