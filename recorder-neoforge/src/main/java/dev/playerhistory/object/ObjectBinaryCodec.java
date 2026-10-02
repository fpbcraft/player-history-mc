package dev.playerhistory.object;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.CRC32;

public final class ObjectBinaryCodec {
  public static final int MAGIC = 0x50484f31, VERSION = 3, MAX_FRAME = 4 * 1024 * 1024;
  private static final int MAX_GROUPS = 32;
  private static final int MAX_INSTANCES_PER_GROUP = 4096;
  private static final int MAX_GROUP_ID_BYTES = 1024;

  public static void header(DataOutput out, long start, long duration) throws IOException {
    out.writeInt(MAGIC);
    out.writeInt(VERSION);
    out.writeLong(start);
    out.writeLong(duration);
  }

  public static byte[] frame(List<ObjectPoint> points, long start) throws IOException {
    var bytes = new ByteArrayOutputStream();
    var out = new DataOutputStream(bytes);
    var previous = new HashMap<Integer, ObjectPoint>();
    varint(out, points.size());
    for (ObjectPoint point : points) {
      ObjectPoint prior =
          previous.getOrDefault(
              point.object(),
              emptyPoint(point.object(), start));
      varint(out, point.object());
      signed(out, point.time() - prior.time());
      varint(out, point.world());
      signed(out, (long) point.x() - prior.x());
      signed(out, (long) point.y() - prior.y());
      signed(out, (long) point.z() - prior.z());
      out.writeShort(point.qx());
      out.writeShort(point.qy());
      out.writeShort(point.qz());
      out.writeShort(point.qw());
      out.writeShort(point.sx());
      out.writeShort(point.sy());
      out.writeShort(point.sz());
      out.writeLong(point.geometry());
      out.writeByte(point.flags());
      writeGroups(out, point.groups());
      previous.put(point.object(), point);
    }

    byte[] data = bytes.toByteArray();
    if (data.length > MAX_FRAME) throw new IOException("Object batch too large");
    var result = new ByteArrayOutputStream();
    var framed = new DataOutputStream(result);
    CRC32 crc = new CRC32();
    crc.update(data);
    framed.writeInt(data.length);
    framed.write(data);
    framed.writeInt((int) crc.getValue());
    return result.toByteArray();
  }

  public record Read(
      long start, long duration, List<ObjectPoint> points, long validBytes, boolean partial) {}

  public static Read read(InputStream source) throws IOException {
    var in = new DataInputStream(new BufferedInputStream(source));
    if (in.readInt() != MAGIC)
      throw new IOException("Unknown object history format");
    int version = in.readInt();
    if (version < 1 || version > VERSION)
      throw new IOException("Unknown object history format version " + version);
    long start = in.readLong(), duration = in.readLong(), valid = 24;
    if (duration < 1000 || duration > 3_600_000) throw new IOException("Invalid duration");
    var points = new ArrayList<ObjectPoint>();
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
        points.addAll(decode(data, start, version));
        valid += size + 8L;
        if (points.size() > 2_000_000) throw new IOException("Object chunk record limit exceeded");
      } catch (IOException | IllegalArgumentException | ArithmeticException ex) {
        partial = true;
        break;
      }
    }
    return new Read(start, duration, List.copyOf(points), valid, partial);
  }

  private static List<ObjectPoint> decode(byte[] bytes, long start, int version) throws IOException {
    var in = new DataInputStream(new ByteArrayInputStream(bytes));
    var points = new ArrayList<ObjectPoint>();
    var previous = new HashMap<Integer, ObjectPoint>();
    int count = bounded(in, 100_000);
    for (int i = 0; i < count; i++) {
      int object = bounded(in, Integer.MAX_VALUE);
      ObjectPoint prior = previous.getOrDefault(object, emptyPoint(object, start));
      ObjectPoint point =
          new ObjectPoint(
              object,
              Math.addExact(prior.time(), unsign(in)),
              bounded(in, Integer.MAX_VALUE),
              Math.toIntExact(prior.x() + unsign(in)),
              Math.toIntExact(prior.y() + unsign(in)),
              Math.toIntExact(prior.z() + unsign(in)),
              in.readShort(),
              in.readShort(),
              in.readShort(),
              in.readShort(),
              version >= 2 ? in.readShort() : (short) ObjectPoint.SCALE_SCALE,
              version >= 2 ? in.readShort() : (short) ObjectPoint.SCALE_SCALE,
              version >= 2 ? in.readShort() : (short) ObjectPoint.SCALE_SCALE,
              in.readLong(),
              in.readUnsignedByte(),
              version >= 3 ? readGroups(in) : List.of());
      points.add(point);
      previous.put(object, point);
    }
    if (in.available() != 0) throw new IOException("Trailing object frame data");
    return points;
  }

  private static ObjectPoint emptyPoint(int object, long start) {
    return new ObjectPoint(
        object,
        start,
        0,
        0,
        0,
        0,
        (short) 0,
        (short) 0,
        (short) 0,
        (short) ObjectPoint.QUATERNION_SCALE,
        (short) ObjectPoint.SCALE_SCALE,
        (short) ObjectPoint.SCALE_SCALE,
        (short) ObjectPoint.SCALE_SCALE,
        0,
        0,
        List.of());
  }

  private static void writeGroups(
      DataOutput out, List<ObjectPoint.InstanceGroup> groups) throws IOException {
    if (groups == null || groups.isEmpty()) {
      varint(out, 0);
      return;
    }
    if (groups.size() > MAX_GROUPS) throw new IOException("Too many instance groups");
    varint(out, groups.size());

    for (ObjectPoint.InstanceGroup group : groups) {
      writeString(out, group.id());
      out.writeLong(group.geometry());
      List<ObjectPoint.Instance> instances = group.instances();
      if (instances.size() > MAX_INSTANCES_PER_GROUP)
        throw new IOException("Too many instances in group");
      varint(out, instances.size());

      for (ObjectPoint.Instance instance : instances) {
        signed(out, instance.x());
        signed(out, instance.y());
        signed(out, instance.z());
        out.writeShort(instance.qx());
        out.writeShort(instance.qy());
        out.writeShort(instance.qz());
        out.writeShort(instance.qw());
        out.writeShort(instance.sx());
        out.writeShort(instance.sy());
        out.writeShort(instance.sz());
      }
    }
  }

  private static List<ObjectPoint.InstanceGroup> readGroups(DataInput in) throws IOException {
    int groupCount = bounded(in, MAX_GROUPS);
    if (groupCount == 0) return List.of();

    var groups = new ArrayList<ObjectPoint.InstanceGroup>(groupCount);
    for (int groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      String id = readString(in);
      long geometry = in.readLong();
      int instanceCount = bounded(in, MAX_INSTANCES_PER_GROUP);
      var instances = new ArrayList<ObjectPoint.Instance>(instanceCount);

      for (int i = 0; i < instanceCount; i++) {
        instances.add(
            new ObjectPoint.Instance(
                Math.toIntExact(unsign(in)),
                Math.toIntExact(unsign(in)),
                Math.toIntExact(unsign(in)),
                in.readShort(),
                in.readShort(),
                in.readShort(),
                in.readShort(),
                in.readShort(),
                in.readShort(),
                in.readShort()));
      }

      groups.add(new ObjectPoint.InstanceGroup(id, geometry, instances));
    }
    return List.copyOf(groups);
  }

  private static void writeString(DataOutput out, String value) throws IOException {
    byte[] encoded = value.getBytes(StandardCharsets.UTF_8);
    if (encoded.length > MAX_GROUP_ID_BYTES) throw new IOException("Instance group id too long");
    varint(out, encoded.length);
    out.write(encoded);
  }

  private static String readString(DataInput in) throws IOException {
    int length = bounded(in, MAX_GROUP_ID_BYTES);
    byte[] encoded = new byte[length];
    in.readFully(encoded);
    return new String(encoded, StandardCharsets.UTF_8);
  }

  private static int bounded(DataInput in, int max) throws IOException {
    long n = varint(in);
    if (n < 0 || n > max) throw new IOException("Invalid count/id");
    return (int) n;
  }

  private static void signed(DataOutput out, long n) throws IOException {
    varint(out, (n << 1) ^ (n >> 63));
  }

  private static long unsign(DataInput in) throws IOException {
    long n = varint(in);
    return (n >>> 1) ^ -(n & 1);
  }

  private static void varint(DataOutput out, long n) throws IOException {
    while ((n & ~127L) != 0) {
      out.writeByte((int) n & 127 | 128);
      n >>>= 7;
    }
    out.writeByte((int) n);
  }

  private static long varint(DataInput in) throws IOException {
    long n = 0;
    for (int shift = 0; shift < 64; shift += 7) {
      int b = in.readUnsignedByte();
      if (shift == 63 && (b & 254) != 0) throw new IOException("Varint overflow");
      n |= (long) (b & 127) << shift;
      if ((b & 128) == 0) return n;
    }
    throw new IOException("Varint overflow");
  }
}
