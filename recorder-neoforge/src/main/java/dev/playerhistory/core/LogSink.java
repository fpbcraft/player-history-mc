package dev.playerhistory.core;

import java.util.Objects;
import org.slf4j.Logger;

/** Severity-aware logging boundary shared by recorder and BlueMap integration components. */
@FunctionalInterface
public interface LogSink {
  void info(String message);

  default void debug(String message) {
    info(message);
  }

  default void warn(String message) {
    info(message);
  }

  default void error(String message) {
    info(message);
  }

  static LogSink slf4j(Logger logger) {
    Objects.requireNonNull(logger);
    return new LogSink() {
      @Override
      public void debug(String message) {
        logger.debug(message);
      }

      @Override
      public void info(String message) {
        logger.info(message);
      }

      @Override
      public void warn(String message) {
        logger.warn(message);
      }

      @Override
      public void error(String message) {
        logger.error(message);
      }
    };
  }
}
