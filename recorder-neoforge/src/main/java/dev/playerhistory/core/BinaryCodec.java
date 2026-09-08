package dev.playerhistory.core;

import java.io.*;
import java.util.*;
import java.util.zip.CRC32;

/** Independent CRC-framed batches allow recovery up to the last complete frame. */
public final class BinaryCodec {
  public static final int MAGIC = 0x50485231, VERSION = 1, MAX_FRAME = 4 * 1024 * 1024;

  public record Batch(List<Point> points, List<HistoryEvent> events) {}

  public static void header(DataOutput out, long start, long duration) throws IOException {
    out.writeInt(MAGIC);
    out.writeInt(VERSION);
    out.writeLong(start);
    out.writeLong(duration);
  }

  public static byte[] frame(Batch batch, long start) throws IOException {
    var bytes = new ByteArrayOutputStream();
    var out = new DataOutputStream(bytes);
    var previous = new HashMap<Integer, Point>();
    varint(out, batch.points.size());
    for (Point p : batch.points) {
      Point a = previous.getOrDefault(p.player(), new Point(p.player(), start, 0, 0, 0, 0, 0));
      varint(out, p.player());
      signed(out, p.time() - a.time());
      varint(out, p.world());
      signed(out, (long) p.x() - a.x());
      signed(out, (long) p.y() - a.y());
      signed(out, (long) p.z() - a.z());
      out.writeByte(p.flags());
      previous.put(p.player(), p);
    }
    varint(out, batch.events.size());
    for (var e : batch.events) {
      var p = e.point();
      varint(out, p.player());
      signed(out, p.time() - start);
      varint(out, p.world());
      signed(out, p.x());
      signed(out, p.y());
      signed(out, p.z());
      out.writeByte(p.flags());
      out.writeUTF(e.type());
      out.writeUTF(e.payload());
    }
    byte[] data = bytes.toByteArray();
    if (data.length > MAX_FRAME) throw new IOException("Batch too large");
    var result = new ByteArrayOutputStream();
    var framed = new DataOutputStream(result);
    CRC32 crc = new CRC32();
    crc.update(data);
    framed.writeInt(data.length);
    framed.write(data);
    framed.writeInt((int) crc.getValue());
    return result.toByteArray();
  }

  public record Read(long start, long duration, Batch batch, long validBytes, boolean partial) {}

  public static Read read(InputStream source) throws IOException {
    var in = new DataInputStream(new BufferedInputStream(source));
    if (in.readInt() != MAGIC || in.readInt() != VERSION)
      throw new IOException("Unknown history format");
    long start = in.readLong(), duration = in.readLong(), valid = 24;
    if (duration < 1000 || duration > 3_600_000) throw new IOException("Invalid duration");
    var points = new ArrayList<Point>();
    var events = new ArrayList<HistoryEvent>();
    boolean partial = false;
    while (true) {
      int first = in.read();
      if (first < 0) break;
      try {
        int size =
            (first << 24)
                | (in.readUnsignedByte() << 16)
                | (in.readUnsignedByte() << 8)
                | in.readUnsignedByte();
        if (size < 0 || size > MAX_FRAME) {
          partial = true;
          break;
        }
        byte[] data = in.readNBytes(size);
        if (data.length != size) throw new EOFException();
        CRC32 crc = new CRC32();
        crc.update(data);
        if (in.readInt() != (int) crc.getValue()) {
          partial = true;
          break;
        }
        Batch b = decode(data, start);
        points.addAll(b.points);
        events.addAll(b.events);
        valid += size + 8L;
        if (points.size() > 2_000_000 || events.size() > 200_000)
          throw new IOException("Chunk record limit exceeded");
      } catch (IOException | IllegalArgumentException | ArithmeticException ex) {
        partial = true;
        break;
      }
    }
    return new Read(
        start, duration, new Batch(List.copyOf(points), List.copyOf(events)), valid, partial);
  }

  private static Batch decode(byte[] bytes, long start) throws IOException {
    var in = new DataInputStream(new ByteArrayInputStream(bytes));
    var ps = new ArrayList<Point>();
    var es = new ArrayList<HistoryEvent>();
    var previous = new HashMap<Integer, Point>();
    int count = bounded(in, 100_000);
    for (int i = 0; i < count; i++) {
      int id = bounded(in, Integer.MAX_VALUE);
      Point a = previous.getOrDefault(id, new Point(id, start, 0, 0, 0, 0, 0));
      Point p =
          new Point(
              id,
              Math.addExact(a.time(), unsign(in)),
              bounded(in, Integer.MAX_VALUE),
              Math.toIntExact(a.x() + unsign(in)),
              Math.toIntExact(a.y() + unsign(in)),
              Math.toIntExact(a.z() + unsign(in)),
              in.readUnsignedByte());
      ps.add(p);
      previous.put(id, p);
    }
    count = bounded(in, 100_000);
    for (int i = 0; i < count; i++)
      es.add(
          new HistoryEvent(
              new Point(
                  bounded(in, Integer.MAX_VALUE),
                  start + unsign(in),
                  bounded(in, Integer.MAX_VALUE),
                  Math.toIntExact(unsign(in)),
                  Math.toIntExact(unsign(in)),
                  Math.toIntExact(unsign(in)),
                  in.readUnsignedByte()),
              in.readUTF(),
              in.readUTF()));
    if (in.available() != 0) throw new IOException("Trailing frame data");
    return new Batch(ps, es);
  }

  private static int bounded(DataInput in, int max) throws IOException {
    long n = varint(in);
    if (n < 0 || n > max) throw new IOException("Invalid count/id");
    return (int) n;
  }

  static void signed(DataOutput out, long n) throws IOException {
    varint(out, (n << 1) ^ (n >> 63));
  }

  static long unsign(DataInput in) throws IOException {
    long n = varint(in);
    return (n >>> 1) ^ -(n & 1);
  }

  static void varint(DataOutput out, long n) throws IOException {
    while ((n & ~127L) != 0) {
      out.writeByte((int) n & 127 | 128);
      n >>>= 7;
    }
    out.writeByte((int) n);
  }

  static long varint(DataInput in) throws IOException {
    long n = 0;
    for (int s = 0; s < 64; s += 7) {
      int b = in.readUnsignedByte();
      if (s == 63 && (b & 254) != 0) throw new IOException("Varint overflow");
      n |= (long) (b & 127) << s;
      if ((b & 128) == 0) return n;
    }
    throw new IOException("Varint overflow");
  }
}
