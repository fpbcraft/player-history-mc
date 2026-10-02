package dev.playerhistory.core;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;

/** Shared low-level I/O for recorder chunk channels. */
public final class ChunkChannelIO {
  private ChunkChannelIO() {}

  public static int writeFully(FileChannel channel, byte[] data) throws IOException {
    var buffer = ByteBuffer.wrap(data);
    while (buffer.hasRemaining()) channel.write(buffer);
    return data.length;
  }

  public static void closeDurably(FileChannel channel) throws IOException {
    channel.force(false);
    channel.close();
  }
}
