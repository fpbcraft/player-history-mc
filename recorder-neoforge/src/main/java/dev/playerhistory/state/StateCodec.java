package dev.playerhistory.state;

import java.io.*;
import java.util.*;
import java.util.zip.CRC32;

/** Independent typed binary stream v1. Frequent values are never serialized as JSON on disk. */
public final class StateCodec {
  public static final int MAGIC = 0x50485331, VERSION = 1, MAX_FRAME = 262144;

  public record Read(List<StateRecord> records, long validBytes, boolean partial) {}

  public static byte[] frame(StateRecord record) throws IOException {
    var bytes = new ByteArrayOutputStream();
    var out = new DataOutputStream(bytes);
    out.writeInt(record.player());
    out.writeLong(record.time());
    out.writeUTF(record.kind());
    value(out, record.values(), 0);
    if (bytes.size() > MAX_FRAME) throw new IOException("State frame exceeds size limit");
    byte[] body = bytes.toByteArray();
    var crc = new CRC32();
    crc.update(body);
    var result = new ByteArrayOutputStream();
    var framed = new DataOutputStream(result);
    framed.writeInt(body.length);
    framed.write(body);
    framed.writeInt((int) crc.getValue());
    return result.toByteArray();
  }

  private static void value(DataOutput out, Object value, int depth) throws IOException {
    if (depth > 8) throw new IOException("State nesting limit");
    if (value == null) out.writeByte(0);
    else if (value instanceof Boolean b) {
      out.writeByte(1);
      out.writeBoolean(b);
    } else if (value instanceof Number n) {
      out.writeByte(2);
      out.writeDouble(n.doubleValue());
    } else if (value instanceof String s) {
      if (s.length() > 8192) throw new IOException("State text limit");
      out.writeByte(3);
      out.writeUTF(s);
    } else if (value instanceof Map<?, ?> m) {
      if (m.size() > 256) throw new IOException("State map limit");
      out.writeByte(4);
      out.writeInt(m.size());
      for (var e : m.entrySet()) {
        out.writeUTF(e.getKey().toString());
        value(out, e.getValue(), depth + 1);
      }
    } else if (value instanceof List<?> l) {
      if (l.size() > 256) throw new IOException("State list limit");
      out.writeByte(5);
      out.writeInt(l.size());
      for (Object v : l) value(out, v, depth + 1);
    } else throw new IOException("Unsupported state value");
  }

  private static Object value(DataInput in, int depth) throws IOException {
    if (depth > 8) throw new IOException("State nesting limit");
    return switch (in.readUnsignedByte()) {
      case 0 -> null;
      case 1 -> in.readBoolean();
      case 2 -> in.readDouble();
      case 3 -> in.readUTF();
      case 4 -> {
        int n = size(in);
        var m = new LinkedHashMap<String, Object>();
        for (int i = 0; i < n; i++) m.put(in.readUTF(), value(in, depth + 1));
        yield m;
      }
      case 5 -> {
        int n = size(in);
        var l = new ArrayList<>();
        for (int i = 0; i < n; i++) l.add(value(in, depth + 1));
        yield l;
      }
      default -> throw new IOException("Unknown value tag");
    };
  }

  private static int size(DataInput in) throws IOException {
    int n = in.readInt();
    if (n < 0 || n > 256) throw new IOException("Value count limit");
    return n;
  }

  @SuppressWarnings("unchecked")
  public static Read read(InputStream source) throws IOException {
    var in = new DataInputStream(new BufferedInputStream(source));
    if (in.readInt() != MAGIC || in.readInt() != VERSION)
      throw new IOException("Unknown state format");
    var records = new ArrayList<StateRecord>();
    long valid = 8;
    boolean partial = false;
    while (true) {
      int first = in.read();
      if (first < 0) break;
      try {
        int n =
            (first << 24)
                | (in.readUnsignedByte() << 16)
                | (in.readUnsignedByte() << 8)
                | in.readUnsignedByte();
        if (n < 0 || n > MAX_FRAME) throw new IOException("Frame limit");
        byte[] body = in.readNBytes(n);
        if (body.length != n) throw new EOFException();
        var crc = new CRC32();
        crc.update(body);
        if (in.readInt() != (int) crc.getValue()) throw new IOException("CRC");
        var data = new DataInputStream(new ByteArrayInputStream(body));
        int player = data.readInt();
        long time = data.readLong();
        String kind = data.readUTF();
        Object values = value(data, 0);
        if (!(values instanceof Map<?, ?>)
            || !Set.of("checkpoint", "delta", "unknown").contains(kind))
          throw new IOException("Invalid state record");
        records.add(new StateRecord(player, time, kind, (Map<String, Object>) values));
        valid += n + 8L;
        if (records.size() > 100000) throw new IOException("State record limit");
      } catch (IOException ex) {
        partial = true;
        break;
      }
    }
    return new Read(List.copyOf(records), valid, partial);
  }
}
