package dev.playerhistory.assets;

import java.lang.reflect.Method;
import java.util.Locale;
import net.minecraft.world.level.Level;

/** Optional Ecliptic Seasons public API. Never invent seasons when the mod is absent. */
final class SeasonStatus {
  private static final SeasonStatus API = load();
  private final Object api;
  private final Method enabled, season, term;
  private SeasonStatus(Object api, Method enabled, Method season, Method term) {
    this.api=api;this.enabled=enabled;this.season=season;this.term=term;
  }
  private static Method method(Class<?> type,String name) {
    try{return type.getMethod(name,Level.class);}catch(ReflectiveOperationException ignored){return null;}
  }
  private static SeasonStatus load() {
    try {
      Class<?> type=Class.forName("com.teamtea.eclipticseasons.api.EclipticSeasonsApi");
      Object api=type.getMethod("getInstance").invoke(null);
      return new SeasonStatus(api,method(type,"isSeasonEnabled"),method(type,"getSeason"),method(type,"getSolarTerm"));
    }catch(ReflectiveOperationException|LinkageError ignored){return null;}
  }
  static String season(Level level) {
    if(API==null||!level.dimensionType().hasSkyLight())return null;
    try {
      if(API.enabled!=null&&!Boolean.TRUE.equals(API.enabled.invoke(API.api,level)))return null;
      Object season;
      if(API.season!=null)season=API.season.invoke(API.api,level);
      else if(API.term!=null){Object term=API.term.invoke(API.api,level);season=term.getClass().getMethod("getSeason").invoke(term);}
      else return null;
      String name=season instanceof Enum<?> value?value.name().toLowerCase(Locale.ROOT):"";
      return switch(name){case "spring","summer","autumn","winter"->name;default->null;};
    }catch(ReflectiveOperationException|RuntimeException|LinkageError ignored){return null;}
  }
}
