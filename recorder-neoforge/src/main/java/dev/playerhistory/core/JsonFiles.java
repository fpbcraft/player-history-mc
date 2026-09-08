package dev.playerhistory.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.*;
import java.nio.file.*;

public final class JsonFiles {
  public static final Gson GSON = new GsonBuilder().serializeNulls().create();

  public static void write(Path path, Object value) throws IOException {
    Files.createDirectories(path.getParent());
    Path tmp = path.resolveSibling(path.getFileName() + ".tmp");
    try (var out = Files.newBufferedWriter(tmp)) {
      GSON.toJson(value, out);
    }
    move(tmp, path);
  }

  public static void move(Path from, Path to) throws IOException {
    try {
      Files.move(from, to, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    } catch (AtomicMoveNotSupportedException e) {
      Files.move(from, to, StandardCopyOption.REPLACE_EXISTING);
    }
  }
}
