#!/usr/bin/env -S deno run -A
/*! otorp (C) 2021-present SheetJS -- http://sheetjs.com */
import { resolve } from "https://deno.land/std@0.171.0/path/mod.ts";
import { TerminalSpinner } from "https://deno.land/x/spinners/mod.ts";

// #region util.ts

var u8_to_dataview = (array: Uint8Array): DataView => new DataView(array.buffer, array.byteOffset, array.byteLength);

var u8str = (u8: Uint8Array): string => new TextDecoder().decode(u8);

var u8concat = (u8a: Uint8Array[]): Uint8Array => {
  var len = u8a.reduce((acc: number, x: Uint8Array) => acc + x.length, 0);
  var out = new Uint8Array(len);
  var off = 0;
  u8a.forEach(u8 => { out.set(u8, off); off += u8.length; });
  return out;
};

var indent = (str: string, depth: number /* = 1 */): string => str.split(/\n/g).map(x => x && "  ".repeat(depth) + x).join("\n");

function u8indexOf(u8: Uint8Array, data: string | number | Uint8Array, byteOffset?: number): number {
  //if(Buffer.isBuffer(u8)) return u8.indexOf(data, byteOffset);
  if(typeof data == "number") return u8.indexOf(data, byteOffset);
  var l = byteOffset;
  if(typeof data == "string") {
    outs: while((l = u8.indexOf(data.charCodeAt(0), l)) > -1) {
      ++l;
      for(var j = 1; j < data.length; ++j) if(u8[l+j-1] != data.charCodeAt(j)) continue outs;
      return l - 1;
    }
  } else {
    outb: while((l = u8.indexOf(data[0], l)) > -1) {
      ++l;
      for(var j = 1; j < data.length; ++j) if(u8[l+j-1] != data[j]) continue outb;
      return l - 1;
    }
  }
  return -1;
}

// #endregion

// #region proto.ts

type Ptr = [number];

/** Parse an integer from the varint that can be exactly stored in a double */
function parse_varint49(buf: Uint8Array, ptr?: Ptr): number {
  var l = ptr ? ptr[0] : 0;
  var usz = buf[l] & 0x7F;
  varint: if(buf[l++] >= 0x80) {
    usz |= (buf[l] & 0x7F) <<  7; if(buf[l++] < 0x80) break varint;
    usz |= (buf[l] & 0x7F) << 14; if(buf[l++] < 0x80) break varint;
    usz |= (buf[l] & 0x7F) << 21; if(buf[l++] < 0x80) break varint;
    usz += (buf[l] & 0x7F) * Math.pow(2, 28); ++l; if(buf[l++] < 0x80) break varint;
    usz += (buf[l] & 0x7F) * Math.pow(2, 35); ++l; if(buf[l++] < 0x80) break varint;
    usz += (buf[l] & 0x7F) * Math.pow(2, 42); ++l; if(buf[l++] < 0x80) break varint;
  }
  if(ptr) ptr[0] = l;
  return usz;
}

function write_varint49(v: number): Uint8Array {
  var usz = new Uint8Array(7);
  usz[0] = (v & 0x7F);
  var L = 1;
  sz: if(v > 0x7F) {
    usz[L-1] |= 0x80; usz[L] = (v >> 7) & 0x7F; ++L;
    if(v <= 0x3FFF) break sz;
    usz[L-1] |= 0x80; usz[L] = (v >> 14) & 0x7F; ++L;
    if(v <= 0x1FFFFF) break sz;
    usz[L-1] |= 0x80; usz[L] = (v >> 21) & 0x7F; ++L;
    if(v <= 0xFFFFFFF) break sz;
    usz[L-1] |= 0x80; usz[L] = ((v/0x100) >>> 21) & 0x7F; ++L;
    if(v <= 0x7FFFFFFFF) break sz;
    usz[L-1] |= 0x80; usz[L] = ((v/0x10000) >>> 21) & 0x7F; ++L;
    if(v <= 0x3FFFFFFFFFF) break sz;
    usz[L-1] |= 0x80; usz[L] = ((v/0x1000000) >>> 21) & 0x7F; ++L;
  }
  return usz.slice(0, L);
}

/** Parse a 32-bit signed integer from the raw varint */
function varint_to_i32(buf: Uint8Array): number {
  var l = 0, i32 = buf[l] & 0x7F;
  varint: if(buf[l++] >= 0x80) {
    i32 |= (buf[l] & 0x7F) <<  7; if(buf[l++] < 0x80) break varint;
    i32 |= (buf[l] & 0x7F) << 14; if(buf[l++] < 0x80) break varint;
    i32 |= (buf[l] & 0x7F) << 21; if(buf[l++] < 0x80) break varint;
    i32 |= (buf[l] & 0x7F) << 28;
  }
  return i32;
}

interface ProtoItem {
  offset?: number;
  data: Uint8Array;
  type: number;
}
type ProtoField = Array<ProtoItem>
type ProtoMessage = Array<ProtoField>;

/** Shallow parse of a message */
function parse_shallow(buf: Uint8Array): ProtoMessage {
  var out: ProtoMessage = [], ptr: Ptr = [0];
  while(ptr[0] < buf.length) {
    var off = ptr[0];
    var num = parse_varint49(buf, ptr);
    var type = num & 0x07; num = Math.floor(num / 8);
    var len = 0;
    var res: Uint8Array;
    if(num == 0) break;
    switch(type) {
      case 0: {
        var l = ptr[0];
        while(buf[ptr[0]++] >= 0x80);
        res = buf.slice(l, ptr[0]);
      } break;
      case 5: len = 4; res = buf.slice(ptr[0], ptr[0] + len); ptr[0] += len; break;
      case 1: len = 8; res = buf.slice(ptr[0], ptr[0] + len); ptr[0] += len; break;
      case 2: len = parse_varint49(buf, ptr); res = buf.slice(ptr[0], ptr[0] + len); ptr[0] += len; break;
      case 3: // Start group
      case 4: // End group
      default: throw new Error(`PB Type ${type} for Field ${num} at offset ${off}`);
    }
    var v: ProtoItem = { offset: off, data: res, type };
    if(out[num] == null) out[num] = [v];
    else out[num].push(v);
  }
  return out;
}

/** Serialize a shallow parse */
function write_shallow(proto: ProtoMessage): Uint8Array {
  var out: Uint8Array[] = [];
  proto.forEach((field, idx) => {
    field.forEach(item => {
      out.push(write_varint49(idx * 8 + item.type));
      out.push(item.data);
    });
  });
  return u8concat(out);
}

function mappa<U>(data: ProtoField, cb:(_:Uint8Array) => U): U[] {
  if(!data) return [];
  return data.map((d) => { try {
    return cb(d.data);
  } catch(e) {
    var m = e.message?.match(/at offset (\d+)/);
    if(m) e.message = e.message.replace(/at offset (\d+)/, "at offset " + (+m[1] + (d.offset||0)));
    throw e;
  }});
}

// #endregion

// #region descriptor.ts

var TYPES = [
  "error",
  "double",
  "float",
  "int64",
  "uint64",
  "int32",
  "fixed64",
  "fixed32",
  "bool",
  "string",
  "group",
  "message",
  "bytes",
  "uint32",
  "enum",
  "sfixed32",
  "sfixed64",
  "sint32",
  "sint64"
];


interface FileOptions {
  javaPackage?: string;
  javaOuterClassname?: string;
  javaMultipleFiles?: string;
  goPackage?: string;
}
function parse_FileOptions(buf: Uint8Array): FileOptions {
  var data = parse_shallow(buf);
  var out: FileOptions = {};
  if(data[1]?.[0]) out.javaPackage = u8str(data[1][0].data);
  if(data[8]?.[0]) out.javaOuterClassname = u8str(data[8][0].data);
  if(data[11]?.[0]) out.goPackage = u8str(data[11][0].data);
  return out;
}


interface EnumValue {
  name?: string;
  number?: number;
}
function parse_EnumValue(buf: Uint8Array): EnumValue {
  var data = parse_shallow(buf);
  var out: EnumValue = {};
  if(data[1]?.[0]) out.name = u8str(data[1][0].data);
  if(data[2]?.[0]) out.number = varint_to_i32(data[2][0].data);
  return out;
}


interface Enum {
  name?: string;
  value?: EnumValue[];
}
function parse_Enum(buf: Uint8Array): Enum {
  var data = parse_shallow(buf);
  var out: Enum = {};
  if(data[1]?.[0]) out.name = u8str(data[1][0].data);
  out.value = mappa(data[2], parse_EnumValue);
  return out;
}
var write_Enum = (en: Enum): string => {
  var out = [`enum ${en.name} {`];
  en.value?.forEach(({name, number}) => out.push(`  ${name} = ${number};`));
  return out.concat(`}`).join("\n");
};


interface FieldOptions {
  packed?: boolean;
  deprecated?: boolean;
}
function parse_FieldOptions(buf: Uint8Array): FieldOptions {
  var data = parse_shallow(buf);
  var out: FieldOptions = {};
  if(data[2]?.[0]) out.packed = !!data[2][0].data;
  if(data[3]?.[0]) out.deprecated = !!data[3][0].data;
  return out;
}


interface Field {
  name?: string;
  extendee?: string;
  number?: number;
  label?: number;
  type?: number;
  typeName?: string;
  defaultValue?: string;
  options?: FieldOptions;
}
function parse_Field(buf: Uint8Array): Field {
  var data = parse_shallow(buf);
  var out: Field = {};
  if(data[1]?.[0]) out.name = u8str(data[1][0].data);
  if(data[2]?.[0]) out.extendee = u8str(data[2][0].data);
  if(data[3]?.[0]) out.number = varint_to_i32(data[3][0].data);
  if(data[4]?.[0]) out.label = varint_to_i32(data[4][0].data);
  if(data[5]?.[0]) out.type = varint_to_i32(data[5][0].data);
  if(data[6]?.[0]) out.typeName = u8str(data[6][0].data);
  if(data[7]?.[0]) out.defaultValue = u8str(data[7][0].data);
  if(data[8]?.[0]) out.options = parse_FieldOptions(data[8][0].data);
  return out;
}
function write_Field(field: Field): string {
  var out = [];
  var label = ["", "optional ", "required ", "repeated "][field.label||0] || "";
  var type = field.typeName || TYPES[field.type||69] || "s5s";
  var opts = [];
  if(field.defaultValue) opts.push(`default = ${field.defaultValue}`);
  if(field.options?.packed) opts.push(`packed = true`);
  if(field.options?.deprecated) opts.push(`deprecated = true`);
  var os = opts.length ? ` [${opts.join(", ")}]`: "";
  out.push(`${label}${type} ${field.name} = ${field.number}${os};`);
  return out.length ? indent(out.join("\n"), 1) : "";
}


function write_extensions(ext: Field[], xtra = false, coalesce = true): string {
  var res: string[] = [];
  var xt: Array<[string, Array<Field>]> = [];
  ext.forEach(ext => {
    if(!ext.extendee) return;
    var row = coalesce ?
      xt.find(x => x[0] == ext.extendee) :
      (xt[xt.length - 1]?.[0] == ext.extendee ? xt[xt.length - 1]: null);
    if(row) row[1].push(ext);
    else xt.push([ext.extendee, [ext]]);
  });
  xt.forEach(extrow => {
    var out = [`extend ${extrow[0]} {`];
    extrow[1].forEach(ext => out.push(write_Field(ext)));
    res.push(out.concat(`}`).join("\n") + (xtra ? "\n" : ""));
  });
  return res.join("\n");
}


interface ExtensionRange { start?: number; end?: number; }
interface MessageType {
  name?: string;
  nestedType?: MessageType[];
  enumType?: Enum[];
  field?: Field[];
  extension?: Field[];
  extensionRange?: ExtensionRange[];
}
function parse_mtype(buf: Uint8Array): MessageType {
  var data = parse_shallow(buf);
  var out: MessageType = {};
  if(data[1]?.[0]) out.name = u8str(data[1][0].data);
  if(data[2]?.length >= 1) out.field = mappa(data[2], parse_Field);
  if(data[3]?.length >= 1) out.nestedType = mappa(data[3], parse_mtype);
  if(data[4]?.length >= 1) out.enumType = mappa(data[4], parse_Enum);
  if(data[6]?.length >= 1) out.extension = mappa(data[6], parse_Field);
  if(data[5]?.length >= 1) out.extensionRange = data[5].map(d => {
    var data = parse_shallow(d.data);
    var out: ExtensionRange = {};
    if(data[1]?.[0]) out.start = varint_to_i32(data[1][0].data);
    if(data[2]?.[0]) out.end   = varint_to_i32(data[2][0].data);
    return out;
  });
  return out;
}
var write_mtype = (message: MessageType): string => {
  var out = [ `message ${message.name} {` ];
  message.nestedType?.forEach(m => out.push(indent(write_mtype(m), 1)));
  message.enumType?.forEach(en => out.push(indent(write_Enum(en), 1)));
  message.field?.forEach(field => out.push(write_Field(field)));
  if(message.extensionRange) message.extensionRange.forEach(er => out.push(`  extensions ${er.start} to ${(er.end||0) - 1};`));
  if(message.extension?.length) out.push(indent(write_extensions(message.extension), 1));
  return out.concat(`}`).join("\n");
};


interface Descriptor {
  name?: string;
  package?: string;
  dependency?: string[];
  messageType?: MessageType[];
  enumType?: Enum[];
  extension?: Field[];
  options?: FileOptions;
}
function parse_FileDescriptor(buf: Uint8Array): Descriptor {
  var data = parse_shallow(buf);
  var out: Descriptor = {};
  if(data[1]?.[0]) out.name = u8str(data[1][0].data);
  if(data[2]?.[0]) out.package = u8str(data[2][0].data);
  if(data[3]?.[0]) out.dependency = data[3].map(x => u8str(x.data));

  if(data[4]?.length >= 1) out.messageType = mappa(data[4], parse_mtype);
  if(data[5]?.length >= 1) out.enumType = mappa(data[5], parse_Enum);
  if(data[7]?.length >= 1) out.extension = mappa(data[7], parse_Field);

  if(data[8]?.[0]) out.options = parse_FileOptions(data[8][0].data);

  return out;
}
var write_FileDescriptor = (pb: Descriptor): string => {
  var out = [
    'syntax = "proto2";',
    ''
  ];
  if(pb.dependency) pb.dependency.forEach((n: string) => { if(n) out.push(`import "${n}";`); });
  if(pb.package) out.push(`package ${pb.package};\n`);
  if(pb.options) {
    var o = out.length;

    if(pb.options.javaPackage) out.push(`option java_package = "${pb.options.javaPackage}";`);
    if(pb.options.javaOuterClassname?.replace(/\W/g, "")) out.push(`option java_outer_classname = "${pb.options.javaOuterClassname}";`);
    if(pb.options.javaMultipleFiles) out.push(`option java_multiple_files = true;`);
    if(pb.options.goPackage) out.push(`option go_package = "${pb.options.goPackage}";`);

    if(out.length > o) out.push('');
  }

  pb.enumType?.forEach(en => { if(en.name) out.push(write_Enum(en) + "\n"); });
  pb.messageType?.forEach(m => { if(m.name) { var o = write_mtype(m); if(o) out.push(o + "\n"); }});

  if(pb.extension?.length) {
    var e = write_extensions(pb.extension, true, false);
    if(e) out.push(e);
  }
  return out.join("\n") + "\n";
};

// #endregion

// #region macho.ts

interface MachOEntry {
  type: number;
  subtype: number;
  offset: number;
  size: number;
  align?: number;
  data: Uint8Array;
}
var parse_fat = (buf: Uint8Array): MachOEntry[] => {
  var dv = u8_to_dataview(buf);
  if(dv.getUint32(0, false) !== 0xCAFEBABE) throw new Error("Unsupported file");
  var nfat_arch = dv.getUint32(4, false);
  var out: MachOEntry[] = [];
  for(var i = 0; i < nfat_arch; ++i) {
    var start = i * 20 + 8;

    var cputype = dv.getUint32(start, false);
    var cpusubtype = dv.getUint32(start+4, false);
    var offset = dv.getUint32(start+8, false);
    var size = dv.getUint32(start+12, false);
    var align = dv.getUint32(start+16, false);

    out.push({
      type: cputype,
      subtype: cpusubtype,
      offset,
      size,
      align,
      data: buf.slice(offset, offset + size)
    });
  }
  return out;
};
var parse_macho = (buf: Uint8Array): MachOEntry[] => {
  var dv = u8_to_dataview(buf);
  var magic = dv.getUint32(0, false);
  switch(magic) {
    // fat binary (x86_64 / aarch64)
    case 0xCAFEBABE: return parse_fat(buf);
    // x86_64
    case 0xCFFAEDFE: return [{
      type: dv.getUint32(4, false),
      subtype: dv.getUint32(8, false),
      offset: 0,
      size: buf.length,
      data: buf
    }];
  }
  throw new Error("Unsupported file");
};

// #endregion

// #region otorp.ts

interface OtorpEntry {
  name: string;
  proto: string;
}

/** Find and stringify all relevant protobuf defs */
function otorp(buf: Uint8Array, builtins = false): OtorpEntry[] {
  var res = proto_offsets(buf);
  var registry: {[key: string]: Descriptor} = {};
  var names: Set<string> = new Set();
  var out: OtorpEntry[] = [];

  res.forEach((r, i) => {
    if(!builtins && r[1].startsWith("google/protobuf/")) return;
    var b = buf.slice(r[0], i < res.length - 1 ? res[i+1][0] : buf.length);
    var pb = parse_FileDescriptorProto(b/*, r[1]*/);
    names.add(r[1]);
    registry[r[1]] = pb;
  });

  names.forEach(name => {
    /* ensure partial ordering by dependencies */
    names.delete(name);
    var pb = registry[name];
    var doit = (pb.dependency||[]).every((d: string) => !names.has(d));
    if(!doit) { names.add(name); return; }

    var dups = res.filter(r => r[1] == name);
    if(dups.length == 1) return out.push({ name, proto: write_FileDescriptor(pb) });

    /* in a fat binary, compare the defs for x86_64/aarch64 */
    var pbs = dups.map(r => {
      var i = res.indexOf(r);
      var b = buf.slice(r[0], i < res.length - 1 ? res[i+1][0] : buf.length);
      var pb = parse_FileDescriptorProto(b/*, r[1]*/);
      return write_FileDescriptor(pb);
    });
    for(var l = 1; l < pbs.length; ++l) if(pbs[l] != pbs[0]) throw new Error(`Conflicting definitions for ${name} at offsets 0x${dups[0][0].toString(16)} and 0x${dups[l][0].toString(16)}`);
    return out.push({ name, proto: pbs[0] });
  });

  return out;
}
export default otorp;

/** Determine if an address is being referenced */
var is_referenced = (buf: Uint8Array, pos: number): boolean => {
  var dv = u8_to_dataview(buf);

  /* Search for LEA reference (x86) */
  for(var leaddr = 0; leaddr > -1 && leaddr < pos; leaddr = u8indexOf(buf, 0x8D, leaddr + 1))
    if(dv.getUint32(leaddr + 2, true) == pos - leaddr - 6) return true;

  /* Search for absolute reference to address */
  try {
    var headers = parse_macho(buf);
    for(var i = 0; i < headers.length; ++i) {
      if(pos < headers[i].offset || pos > headers[i].offset + headers[i].size) continue;
      var b = headers[i].data;
      var p = pos - headers[i].offset;
      var ref = new Uint8Array([0,0,0,0,0,0,0,0]);
      var dv = u8_to_dataview(ref);
      dv.setUint32(0, p, true);
      if(u8indexOf(b, ref, 0) > 0) return true;
      ref[4] = 0x01;
      if(u8indexOf(b, ref, 0) > 0) return true;
      ref[4] = 0x00; ref[6] = 0x10;
      if(u8indexOf(b, ref, 0) > 0) return true;
    }
  } catch(e) {throw e}
  return false;
};

type OffsetList = Array<[number, string, number, number]>;
/** Generate a list of potential starting points */
var proto_offsets = (buf: Uint8Array): OffsetList => {
  var meta = parse_macho(buf);
  var out: OffsetList = [];
  var off = 0;
  /* note: this loop only works for names < 128 chars */
  search: while((off = u8indexOf(buf, ".proto", off + 1)) > -1) {
    var pos = off;
    off += 6;
    while(off - pos < 256 && buf[pos] != off - pos - 1) {
      if(buf[pos] > 0x7F || buf[pos] < 0x20) continue search;
      --pos;
    }
    if(off - pos > 250) continue;
    var name = u8str(buf.slice(pos + 1, off));
    if(buf[--pos] != 0x0A) continue;
    if(!is_referenced(buf, pos)) { console.error(`Reference to ${name} at ${pos} not found`); continue; }
    var bin = meta.find(m => m.offset <= pos && m.offset + m.size >= pos);
    out.push([pos, name, bin?.type || -1, bin?.subtype || -1]);
  }
  return out;
};

/** Parse a descriptor that starts with the first byte of the supplied buffer */
var parse_FileDescriptorProto = (buf: Uint8Array): Descriptor => {
  var l = buf.length;
  while(l > 0) try {
    var b = buf.slice(0,l);
    var o = parse_FileDescriptor(b);
    return o;
  } catch(e) {
    var m = e.message.match(/at offset (\d+)/);
    if(m && parseInt(m[1], 10) < buf.length) l = parseInt(m[1], 10) - 1;
    else --l;
  }
  throw new RangeError("no protobuf message in range");
};


// #endregion

let spin: TerminalSpinner;
const width = Deno.consoleSize().columns;
function process(inf: string, outf: string) {
  const fi = Deno.statSync(inf);
  if(fi.isDirectory) for(let info of Deno.readDirSync(inf)) {
    if(spin) spin.set(inf.length > width - 4 ? "…" + inf.slice(-(width-4)) : inf);
    process(inf + (inf.slice(-1) == "/" ? "" : "/") + info.name, outf);
  }
  try {
    const buf: Uint8Array = Deno.readFileSync(inf);
    var dv = u8_to_dataview(buf);
    var magic = dv.getUint32(0, false);
    if(![0xCAFEBABE, 0xCFFAEDFE].includes(magic)) return;

    otorp(buf).forEach(({name, proto}) => {
      if(!outf) return console.log(proto);
      var pth = resolve(outf || "./", name.replace(/[/]/g, "$"));
      try {
        const str = Deno.readTextFileSync(pth);
        if(str == proto) return;
        throw `${pth} definition diverges!`;
      } catch(e) { if(typeof e == "string") throw e; }
      console.error(`writing ${name} to ${pth}`);
      Deno.writeTextFileSync(pth, proto);
    });
  } catch(e) {}
}

function doit() {
  const [ inf, outf ] = Deno.args;
  if(!inf || inf == "-h" || inf == "--help") {
    console.log(`usage: otorp.ts <path/to/bin> [output/folder]

if no output folder specified, log all discovered defs
if output folder specified, attempt to write defs in the folder

$ otorp.ts /Applications/Numbers.app out/                   # search all files
$ otorp.ts /Applications/Numbers.app/Contents/MacOS/Numbers # search one file
`);
    Deno.exit(1);
  }
  if(Deno.statSync(inf).isDirectory) (spin = new TerminalSpinner("")).start();
  if(outf) try { Deno.mkdirSync(outf, { recursive: true }); } catch(e) {}
  process(inf, outf);
  if(spin) spin.stop();
}
doit();
