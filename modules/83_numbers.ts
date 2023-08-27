/*! sheetjs (C) 2013-present SheetJS -- http://sheetjs.com */
/// <reference path="src/types.ts"/>

/* these are type imports and do not show up in the generated JS */
import { CFB$Container, CFB$Entry } from 'cfb';
import { WorkBook, WorkSheet, Range, CellObject, ParsingOptions, WritingOptions, DenseWorkSheet, Comments } from '../';
import type { utils, NumberFormat } from "../";

declare var encode_col: typeof utils.encode_col;
declare var encode_row: typeof utils.encode_row;
declare var encode_range: typeof utils.encode_range;
declare var book_new: typeof utils.book_new;
declare var book_append_sheet: typeof utils.book_append_sheet;
declare var decode_range: typeof utils.decode_range;
declare var numdate: (num: number) => Date;
declare var table_fmt: {[nf: number]: string};
declare function fmt_is_date(fmt: NumberFormat): boolean;
import * as _CFB from 'cfb';
declare var CFB: typeof _CFB;
//<<import { utils } from "../../";
//<<const { encode_col, encode_row, encode_range, book_new, book_append_sheet } = utils;

/* see https://bugs.webkit.org/show_bug.cgi?id=243148 -- affects iOS Safari */
declare var Buffer: any; // Buffer is typeof-guarded but TS still needs this :(
var subarray: "subarray" | "slice" = (() => {
	try {
		if(typeof Uint8Array == "undefined") return "slice";
		if(typeof Uint8Array.prototype.subarray == "undefined") return "slice";
		// NOTE: feature tests are for node < 6.x
		if(typeof Buffer !== "undefined") {
			if(typeof Buffer.prototype.subarray == "undefined") return "slice";
			if((typeof Buffer.from == "function" ? Buffer.from([72,62]) : new Buffer([72,62])) instanceof Uint8Array) return "subarray";
			return "slice";
		}
		return "subarray";
	} catch(e) { return "slice"; }
})();

function u8_to_dataview(array: Uint8Array): DataView { return new DataView(array.buffer, array.byteOffset, array.byteLength); }
//<<export { u8_to_dataview };

function u8str(u8: Uint8Array): string { return /* Buffer.isBuffer(u8) ? u8.toString() :*/ typeof TextDecoder != "undefined" ? new TextDecoder().decode(u8) : utf8read(a2s(u8)); }
function stru8(str: string): Uint8Array { return typeof TextEncoder != "undefined" ? new TextEncoder().encode(str) : s2a(utf8write(str)) as Uint8Array; }
//<<export { u8str, stru8 };

/** Concatenate Uint8Arrays */
function u8concat(u8a: Uint8Array[]): Uint8Array {
	var len = 0;
	for(var i = 0; i < u8a.length; ++i) len += u8a[i].length;
	var out = new Uint8Array(len);
	var off = 0;
	for(i = 0; i < u8a.length; ++i) {
		var u8 = u8a[i], L = u8.length;
		if(L < 250) { for(var j = 0; j < L; ++j) out[off++] = u8[j]; }
		else { out.set(u8, off); off += L; }
	}
	return out;
}
//<<export { u8concat };

/** Count the number of bits set (assuming int32_t interpretation) */
function popcnt(x: number): number {
	x -= ((x >> 1) & 0x55555555);
	x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
	return (((x + (x >> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

/** Read a 128-bit decimal from the modern cell storage */
function readDecimal128LE(buf: Uint8Array, offset: number): number {
	var exp = ((buf[offset + 15] & 0x7F) << 7) | (buf[offset + 14] >> 1);
	var mantissa = buf[offset + 14] & 1;
	for(var j = offset + 13; j >= offset; --j) mantissa = mantissa * 256 + buf[j];
	return ((buf[offset+15] & 0x80) ? -mantissa : mantissa) * Math.pow(10, exp - 0x1820);
}
/** Write a 128-bit decimal to the modern cell storage */
function writeDecimal128LE(buf: Uint8Array, offset: number, value: number): void {
	// TODO: something more correct than this
	var exp = Math.floor(value == 0 ? 0 : /*Math.log10*/Math.LOG10E * Math.log(Math.abs(value))) + 0x1820 - 16;
	var mantissa = (value / Math.pow(10, exp - 0x1820));
	buf[offset+15] |= exp >> 7;
	buf[offset+14] |= (exp & 0x7F) << 1;
	for(var i = 0; mantissa >= 1; ++i, mantissa /= 256) buf[offset + i] = mantissa & 0xFF;
	buf[offset+15] |= (value >= 0 ? 0 : 0x80);
}


interface Ptr { l: number; }

/** Parse an integer from the varint that can be exactly stored in a double */
function parse_varint49(buf: Uint8Array, ptr: Ptr): number {
	var l = ptr.l;
	var usz = buf[l] & 0x7F;
	varint: if(buf[l++] >= 0x80) {
		usz |= (buf[l] & 0x7F) <<  7; if(buf[l++] < 0x80) break varint;
		usz |= (buf[l] & 0x7F) << 14; if(buf[l++] < 0x80) break varint;
		usz |= (buf[l] & 0x7F) << 21; if(buf[l++] < 0x80) break varint;
		usz += (buf[l] & 0x7F) * Math.pow(2, 28); ++l; if(buf[l++] < 0x80) break varint;
		usz += (buf[l] & 0x7F) * Math.pow(2, 35); ++l; if(buf[l++] < 0x80) break varint;
		usz += (buf[l] & 0x7F) * Math.pow(2, 42); ++l; if(buf[l++] < 0x80) break varint;
	}
	ptr.l = l;
	return usz;
}
/** Write a varint up to 7 bytes / 49 bits */
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
	return usz[subarray](0, L);
}
/** Parse a repeated varint [packed = true] field */
function parse_packed_varints(buf: Uint8Array): number[] {
	var ptr: Ptr = {l: 0};
	var out: number[] = [];
	while(ptr.l < buf.length) out.push(parse_varint49(buf, ptr));
	return out;
}
/** Write a repeated varint [packed = true] field */
function write_packed_varints(nums: number[]): Uint8Array {
	return u8concat(nums.map(x => write_varint49(x)));
}
//<<export { parse_varint49, write_varint49 };

/** Parse a 32-bit signed integer from the raw varint */
function varint_to_i32(buf: Uint8Array): number {
	var l = 0,
	i32  = (buf[l] & 0x7F)      ; if(buf[l++] < 0x80) return i32;
	i32 |= (buf[l] & 0x7F) <<  7; if(buf[l++] < 0x80) return i32;
	i32 |= (buf[l] & 0x7F) << 14; if(buf[l++] < 0x80) return i32;
	i32 |= (buf[l] & 0x7F) << 21; if(buf[l++] < 0x80) return i32;
	i32 |= (buf[l] & 0x0F) << 28;                     return i32;
}
/** Parse a 64-bit unsigned integer as a pair */
function varint_to_u64(buf: Uint8Array): [number, number] {
	var l = 0, lo = buf[l] & 0x7F, hi = 0;
	varint: if(buf[l++] >= 0x80) {
		lo |= (buf[l] & 0x7F) <<  7; if(buf[l++] < 0x80) break varint;
		lo |= (buf[l] & 0x7F) << 14; if(buf[l++] < 0x80) break varint;
		lo |= (buf[l] & 0x7F) << 21; if(buf[l++] < 0x80) break varint;
		lo |= (buf[l] & 0x7F) << 28; hi = (buf[l] >> 4) & 0x07; if(buf[l++] < 0x80) break varint;
		hi |= (buf[l] & 0x7F) <<  3; if(buf[l++] < 0x80) break varint;
		hi |= (buf[l] & 0x7F) << 10; if(buf[l++] < 0x80) break varint;
		hi |= (buf[l] & 0x7F) << 17; if(buf[l++] < 0x80) break varint;
		hi |= (buf[l] & 0x7F) << 24; if(buf[l++] < 0x80) break varint;
		hi |= (buf[l] & 0x7F) << 31;
	}
	return [lo >>> 0, hi >>> 0];
}
//<<export { varint_to_i32 };

interface ProtoItem {
	data: Uint8Array;
	type: number;
}
type ProtoField = Array<ProtoItem>;
type ProtoMessage = Array<ProtoField>;
/** Shallow parse of a Protobuf message */
function parse_shallow(buf: Uint8Array): ProtoMessage {
	var out: ProtoMessage = [], ptr: Ptr = {l: 0};
	while(ptr.l < buf.length) {
		var off = ptr.l;
		var num = parse_varint49(buf, ptr);
		var type = num & 0x07; num = (num / 8)|0;
		var data: Uint8Array;
		var l = ptr.l;
		switch(type) {
			case 0: {
				while(buf[l++] >= 0x80);
				data = buf[subarray](ptr.l, l);
				ptr.l = l;
			} break;
			case 1: { data = buf[subarray](l, l + 8); ptr.l = l + 8; } break;
			case 2: {
				var len = parse_varint49(buf, ptr);
				data = buf[subarray](ptr.l, ptr.l + len);
				ptr.l += len;
			} break;
			case 5: { data = buf[subarray](l, l + 4); ptr.l = l + 4; } break;
			default: throw new Error(`PB Type ${type} for Field ${num} at offset ${off}`);
		}
		var v: ProtoItem = { data, type };
		if(out[num] == null) out[num] = [];
		out[num].push(v);
	}
	return out;
}
/** Serialize a shallow parse */
function write_shallow(proto: ProtoMessage): Uint8Array {
	var out: Uint8Array[] = [];
	proto.forEach((field, idx) => {
		if(idx == 0) return;
		field.forEach(item => {
			if(!item.data) return;
			out.push(write_varint49(idx * 8 + item.type));
			if(item.type == 2) out.push(write_varint49(item.data.length));
			out.push(item.data);
		});
	});
	return u8concat(out);
}
//<<export { parse_shallow, write_shallow };

/** Map over each entry in a repeated (or single-value) field */
function mappa<U>(data: ProtoField, cb: (u: Uint8Array) => U): U[] {
	return data?.map(d =>  cb(d.data)) || [];
}


interface IWAMessage {
	/** Metadata in .TSP.MessageInfo */
	meta: ProtoMessage;
	data: Uint8Array;
}
interface IWAArchiveInfo {
	id: number;
	merge?: boolean;
	messages: IWAMessage[];
}
/** Extract all messages from a IWA file */
function parse_iwa_file(buf: Uint8Array): IWAArchiveInfo[] {
	var out: IWAArchiveInfo[] = [], ptr: Ptr = {l: 0};
	while(ptr.l < buf.length) {
		/* .TSP.ArchiveInfo */
		var len = parse_varint49(buf, ptr);
		var ai = parse_shallow(buf[subarray](ptr.l, ptr.l + len));
		ptr.l += len;

		var res: IWAArchiveInfo = {
			/* TODO: technically ID is optional */
			id: varint_to_i32(ai[1][0].data),
			messages: []
		};
		ai[2].forEach(b => {
			var mi = parse_shallow(b.data);
			var fl = varint_to_i32(mi[3][0].data);
			res.messages.push({
				meta: mi,
				data: buf[subarray](ptr.l, ptr.l + fl)
			});
			ptr.l += fl;
		});
		if(ai[3]?.[0]) res.merge = (varint_to_i32(ai[3][0].data) >>> 0) > 0;
		out.push(res);
	}
	return out;
}
/** Generate an IWA file from a parsed structure */
function write_iwa_file(ias: IWAArchiveInfo[]): Uint8Array {
	var bufs: Uint8Array[] = [];
	ias.forEach(ia => {
		var ai: ProtoMessage = [ [],
			[ {data: write_varint49(ia.id), type: 0} ],
			[]
		];
		if(ia.merge != null) ai[3] = [ { data: write_varint49(+!!ia.merge), type: 0 } ];
		var midata: Uint8Array[] = [];

		ia.messages.forEach(mi => {
			midata.push(mi.data);
			mi.meta[3] = [ { type: 0, data: write_varint49(mi.data.length) } ];
			ai[2].push({data: write_shallow(mi.meta), type: 2});
		});

		var aipayload = write_shallow(ai);
		bufs.push(write_varint49(aipayload.length));
		bufs.push(aipayload);
		midata.forEach(mid => bufs.push(mid));
	});
	return u8concat(bufs);
}
//<<export { IWAMessage, IWAArchiveInfo, parse_iwa_file, write_iwa_file };

/** Decompress a snappy chunk */
function parse_snappy_chunk(type: number, buf: Uint8Array): Uint8Array[] {
	if(type != 0) throw new Error(`Unexpected Snappy chunk type ${type}`);
	var ptr: Ptr = {l: 0};

	var usz = parse_varint49(buf, ptr);
	var chunks: Uint8Array[] = [];
	var l = ptr.l;
	while(l < buf.length) {
		var tag = buf[l] & 0x3;
		if(tag == 0) {
			var len = buf[l++] >> 2;
			if(len < 60) ++len;
			else {
				var c = len - 59;
				len = buf[l];
				if(c > 1) len |= (buf[l+1]<<8);
				if(c > 2) len |= (buf[l+2]<<16);
				if(c > 3) len |= (buf[l+3]<<24);
				len >>>=0; len++;
				l += c;
			}
			chunks.push(buf[subarray](l, l + len)); l += len; continue;
		} else {
			var offset = 0, length = 0;
			if(tag == 1) {
				length = ((buf[l] >> 2) & 0x7) + 4;
				offset = (buf[l++] & 0xE0) << 3;
				offset |= buf[l++];
			} else {
				length = (buf[l++] >> 2) + 1;
				if(tag == 2) { offset = buf[l] | (buf[l+1]<<8); l += 2; }
				else { offset = (buf[l] | (buf[l+1]<<8) | (buf[l+2]<<16) | (buf[l+3]<<24))>>>0; l += 4; }
			}
			if(offset == 0) throw new Error("Invalid offset 0");
			var j = chunks.length - 1, off = offset;
			while(j >=0 && off >= chunks[j].length) { off -= chunks[j].length; --j; }
			if(j < 0) {
				if(off == 0) off = chunks[(j = 0)].length;
				else throw new Error("Invalid offset beyond length");
			}
			// Node 0.8 Buffer slice does not support negative indices
			if(length < off) chunks.push(chunks[j][subarray](chunks[j].length-off, chunks[j].length-off + length));
			else {
				if(off > 0) { chunks.push(chunks[j][subarray](chunks[j].length-off)); length -= off; } ++j;
				while(length >= chunks[j].length) { chunks.push(chunks[j]); length -= chunks[j].length; ++j; }
				if(length) chunks.push(chunks[j][subarray](0, length));
			}
			if(chunks.length > 25) chunks = [u8concat(chunks)];
		}
	}
	var clen = 0; for(var u8i = 0; u8i < chunks.length; ++u8i) clen += chunks[u8i].length;
	if(clen != usz) throw new Error(`Unexpected length: ${clen} != ${usz}`);
	return chunks;
}

/** Decompress IWA file */
function decompress_iwa_file(buf: Uint8Array): Uint8Array {
	if(Array.isArray(buf)) buf = new Uint8Array(buf);
	var out: Uint8Array[] = [];
	var l = 0;
	while(l < buf.length) {
		var t = buf[l++];
		var len = buf[l] | (buf[l+1]<<8) | (buf[l+2] << 16); l += 3;
		out.push.apply(out, parse_snappy_chunk(t, buf[subarray](l, l + len)));
		l += len;
	}
	if(l !== buf.length) throw new Error("data is not a valid framed stream!");
	return out.length == 1 ? out[0] : u8concat(out);
}

/** Compress IWA file */
function compress_iwa_file(buf: Uint8Array): Uint8Array {
	var out: Uint8Array[] = [];
	var l = 0;
	while(l < buf.length) {
		var c = Math.min(buf.length - l, 0xFFFFFFF);
		var frame = new Uint8Array(4);
		out.push(frame);
		var usz = write_varint49(c);
		var L = usz.length;
		out.push(usz);

		if(c <= 60) { L++; out.push(new Uint8Array([(c - 1)<<2])); }
		else if(c <= 0x100)       { L += 2; out.push(new Uint8Array([0xF0, (c-1) & 0xFF])); }
		else if(c <= 0x10000)     { L += 3; out.push(new Uint8Array([0xF4, (c-1) & 0xFF, ((c-1) >> 8) & 0xFF])); }
		else if(c <= 0x1000000)   { L += 4; out.push(new Uint8Array([0xF8, (c-1) & 0xFF, ((c-1) >> 8) & 0xFF, ((c-1) >> 16) & 0xFF])); }
		else if(c <= 0x100000000) { L += 5; out.push(new Uint8Array([0xFC, (c-1) & 0xFF, ((c-1) >> 8) & 0xFF, ((c-1) >> 16) & 0xFF, ((c-1) >>> 24) & 0xFF])); }

		out.push(buf[subarray](l, l + c)); L += c;

		frame[0] = 0;
		frame[1] = L & 0xFF; frame[2] = (L >>  8) & 0xFF; frame[3] = (L >> 16) & 0xFF;
		l += c;
	}
	return u8concat(out);
}
//<<export { decompress_iwa_file, compress_iwa_file };

/** Rich Text */
interface RichText {
	/** Raw Text */
	v: string;

	/** First Hyperlink */
	l?: string;
}

/** IWA tree-style comment */
interface IWAComment {
	/** text */
	t?: string;
	/** author */
	a?: string;
	replies?: IWAComment[];
}
/** .TST.DataStore */
interface DataLUT {
	/** shared string table */
	sst: string[];
	/** rich string table table */
	rsst: RichText[];
	/** old format table */
	ofmt: ProtoMessage[];
	/** new format table */
	nfmt: ProtoMessage[];
	/** formula */
	fmla: ProtoMessage[];
	/** formula errors */
	ferr: ProtoMessage[];
	/** comment table */
	cmnt: IWAComment[];
}
var numbers_lut_new = (): DataLUT => ({ sst: [], rsst: [], ofmt: [], nfmt: [], fmla: [], ferr: [], cmnt: [] });

function numbers_format_cell(cell: CellObject, t: number, flags: number, ofmt: ProtoMessage, nfmt: ProtoMessage): void {
	var ctype = t & 0xFF, ver = t >> 8;
	/* .TSK.FormatStructArchive */
	var fmt = ver >= 5 ? nfmt : ofmt;
	dur: if((flags & (ver > 4 ? 8: 4)) && cell.t == "n" && ctype == 7) {
		var dstyle =   (fmt[7]?.[0])  ? varint_to_i32(fmt[7][0].data)  : -1;
		if(dstyle == -1) break dur;
		var dmin =     (fmt[15]?.[0]) ? varint_to_i32(fmt[15][0].data) : -1;
		var dmax =     (fmt[16]?.[0]) ? varint_to_i32(fmt[16][0].data) : -1;
		var auto =     (fmt[40]?.[0]) ? varint_to_i32(fmt[40][0].data) : -1;
		var d: number = cell.v as number, dd = d;
		autodur: if(auto) { // TODO: check if numbers reformats on load
			if(d == 0) { dmin = dmax = 2; break autodur; }
			if(d >= 604800) dmin = 1;
			else if(d >= 86400) dmin = 2;
			else if(d >= 3600) dmin = 4;
			else if(d >= 60) dmin = 8;
			else if(d >= 1) dmin = 16;
			else dmin = 32;
			if(Math.floor(d) != d) dmax = 32;
			else if(d % 60) dmax = 16;
			else if(d % 3600) dmax = 8;
			else if(d % 86400) dmax = 4;
			else if(d % 604800) dmax = 2;
			if(dmax < dmin) dmax = dmin;
		}
		if(dmin == -1 || dmax == -1) break dur;
		var dstr: string[] = [], zstr: string[] = [];
		/* TODO: plurality, SSF equivalents */
		if(dmin == 1) {
			dd = d / 604800;
			if(dmax == 1) { zstr.push('d"d"'); } else { dd |= 0; d -= 604800 * dd; }
			dstr.push(dd + (dstyle == 2 ? " week" + (dd == 1 ? "" : "s") : dstyle == 1 ? "w": ""));
		}
		if(dmin <= 2 && dmax >= 2) {
			dd = d / 86400;
			if(dmax > 2) { dd |= 0; d -= 86400 * dd; }
			zstr.push("d" + '"d"');
			dstr.push(dd + (dstyle == 2 ? " day" + (dd == 1 ? "" : "s") : dstyle == 1 ? "d" : ""));
		}
		if(dmin <= 4 && dmax >= 4) {
			dd = d / 3600;
			if(dmax > 4) { dd |= 0; d -= 3600 * dd; }
			zstr.push((dmin >= 4 ? "[h]" : "h") + '"h"');
			dstr.push(dd + (dstyle == 2 ? " hour" + (dd == 1 ? "" : "s") : dstyle == 1 ? "h" : ""));
		}
		if(dmin <= 8 && dmax >= 8) {
			dd = d / 60;
			if(dmax > 8) { dd |= 0; d -= 60 * dd; }
			zstr.push((dmin >= 8 ? "[m]" : "m") + '"m"');
			if(dstyle == 0) dstr.push(((dmin == 8 && dmax == 8 || dd >= 10) ? "" : "0") + dd);
			else dstr.push(dd + (dstyle == 2 ? " minute" + (dd == 1 ? "" : "s") : dstyle == 1 ? "m" : ""));
		}
		if(dmin <= 16 && dmax >= 16) {
			dd = d;
			if(dmax > 16) { dd |= 0; d -= dd; }
			zstr.push((dmin >= 16 ? "[s]" : "s") + '"s"');
			if(dstyle == 0) dstr.push((dmax == 16 && dmin == 16 || dd >= 10 ? "" : "0") + dd);
			else dstr.push(dd + (dstyle == 2 ? " second" + (dd == 1 ? "" : "s") : dstyle == 1 ? "s" : ""));
		}
		if(dmax >= 32) {
			dd = Math.round(1000 * d);
			if(dmin < 32) zstr.push(".000" + '"ms"');
			if(dstyle == 0) dstr.push((dd >= 100 ? "" : dd >= 10 ? "0" : "00") + dd);
			else dstr.push(dd + (dstyle == 2 ? " millisecond" + (dd == 1 ? "" : "s") : dstyle == 1 ? "ms" : ""));
		}
		cell.w = dstr.join(dstyle == 0 ? ":" : " "); cell.z = zstr.join(dstyle == 0 ? '":"': " ");
		if(dstyle == 0) cell.w = cell.w.replace(/:(\d\d\d)$/, ".$1");
	}
}

/** Parse "old storage" (version 0..4) */
function parse_old_storage(buf: Uint8Array, lut: DataLUT, v: 0|1|2|3|4, opts?: ParsingOptions): CellObject | void {
	var dv = u8_to_dataview(buf);
	var flags = dv.getUint32(4, true);

	var ridx = -1, sidx = -1, zidx = -1, ieee = NaN, dc = 0, dt = new Date(Date.UTC(2001, 0, 1));
	var doff = (v > 1 ? 12 : 8);
	if(flags & 0x0002) { zidx = dv.getUint32(doff,  true); doff += 4;}
	doff += popcnt(flags & (v > 1 ? 0x0D8C : 0x018C)) * 4;

	if(flags & 0x0200) { ridx = dv.getUint32(doff,  true); doff += 4; }
	doff += popcnt(flags & (v > 1 ? 0x3000 : 0x1000)) * 4;
	if(flags & 0x0010) { sidx = dv.getUint32(doff,  true); doff += 4; }
	if(flags & 0x0020) { ieee = dv.getFloat64(doff, true); doff += 8; }
	if(flags & 0x0040) { dt.setTime(dt.getTime() +  (dc = dv.getFloat64(doff, true)) * 1000); doff += 8; }

	if(v > 1) {
		flags = dv.getUint32(8, true) >>> 16;
		/* TODO: stress test if a cell can have multiple sub-type formats */
		if(flags & 0xFF) { if(zidx == -1) zidx = dv.getUint32(doff, true); doff += 4; }
	}

	var ret: CellObject;
	var t = buf[v >= 4 ? 1 : 2];
	switch(t) {
		case 0: return void 0; // return { t: "z" }; // blank?
		case 2: ret = { t: "n", v: ieee }; break; // number
		case 3: ret = { t: "s", v: lut.sst[sidx] }; break; // string
		case 5: { // date-time
			if(opts?.cellDates) ret = { t: "d", v: dt };
			else ret = ({ t: "n", v: dc/(86400)+35430, z: table_fmt[14]});
		} break;
		case 6: ret = { t: "b", v: ieee > 0 }; break; // boolean
		case 7: ret = { t: "n", v: ieee }; break; // duration in seconds
		case 8: ret = { t: "e", v: 0}; break; // "formula error" TODO: enumerate and map errors to csf equivalents
		case 9: { // "rich text"
			if(ridx > -1) {
				var rts = lut.rsst[ridx];
				ret = { t: "s", v: rts.v };
				if(rts.l) ret.l = { Target: rts.l };
			} else throw new Error(`Unsupported cell type ${buf[subarray](0,4)}`);
		} break;
		default: throw new Error(`Unsupported cell type ${buf[subarray](0,4)}`);
	}

	if(zidx > -1) numbers_format_cell(ret, t | (v<<8), flags, lut.ofmt[zidx], lut.nfmt[zidx]);
	if(t == 7) (ret.v as number) /= 86400;
	return ret;
}

/** Parse "new storage" (version 5) */
function parse_new_storage(buf: Uint8Array, lut: DataLUT, opts?: ParsingOptions): CellObject | void {
	var dv = u8_to_dataview(buf);
	// TODO: bytes 2:3 appear to be unused?
	var flags = dv.getUint32(4, true);
	var fields = dv.getUint32(8, true);
	var doff = 12;

	var ridx = -1, sidx = -1, zidx = -1, d128 = NaN, ieee = NaN, dc = 0, dt = new Date(Date.UTC(2001, 0, 1)), eidx = -1, fidx = -1;

	//          0x00001F data
	if(fields & 0x000001) { d128 = readDecimal128LE(buf, doff); doff += 16; }
	if(fields & 0x000002) { ieee = dv.getFloat64(doff, true); doff += 8; }
	if(fields & 0x000004) { dt.setTime(dt.getTime() +  (dc = dv.getFloat64(doff, true)) * 1000); doff += 8; }
	if(fields & 0x000008) { sidx = dv.getUint32(doff,  true); doff += 4; }
	if(fields & 0x000010) { ridx = dv.getUint32(doff,  true); doff += 4; }

	//          0x0001E0 styling
	doff += popcnt(fields & 0x0001E0) * 4;

	//          0x000E00 formula
	if(fields & 0x000200) { fidx = dv.getUint32(doff,  true); doff += 4; }
	doff += popcnt(fields & 0x000400) * 4;
	if(fields & 0x000800) { eidx = dv.getUint32(doff,  true); doff += 4; }

	var ret: CellObject;
	var t = buf[1];
	switch(t) {
		case  0: ret = { t: "z" }; break;
		case  2: ret = { t: "n", v: d128 }; break; // number
		case  3: ret = { t: "s", v: lut.sst[sidx] }; break; // string
		case  5: { // date-time
			if(opts?.cellDates) ret = { t: "d", v: dt };
			else ret = ({ t: "n", v: dc/(86400)+35430, z: table_fmt[14]});
		} break;
		case  6: ret = { t: "b", v: ieee > 0 }; break; // boolean
		case  7: ret = { t: "n", v: ieee }; break;  // duration in "s", fixed later
		case  8: ret = { t: "e", v: 0 }; break; // "formula error" TODO: enumerate and map errors to csf equivalents
		case  9: {
			if(ridx > -1) {
				var rts = lut.rsst[ridx];
				ret = { t: "s", v: rts.v };
				if(rts.l) ret.l = { Target: rts.l };
			} else throw new Error(`Unsupported cell type ${buf[1]} : ${fields & 0x1F} : ${buf[subarray](0,4)}`);
		} break; // "rich text"
		case 10: ret = { t: "n", v: d128 }; break; // currency
		default: throw new Error(`Unsupported cell type ${buf[1]} : ${fields & 0x1F} : ${buf[subarray](0,4)}`);
	}

	//          0x001000 something related to cell format
	doff += popcnt(fields & 0x001000) * 4;

	/* TODO: stress test if a cell can have multiple sub-type formats */
	//          0x07E000 formats
	if(fields & 0x07E000) { if(zidx == -1) zidx = dv.getUint32(doff, true); doff += 4; }

	//          0x080000 comment
	if(fields & 0x080000) {
		var cmntidx = dv.getUint32(doff, true); doff += 4;
		if(lut.cmnt[cmntidx]) ret.c = iwa_to_s5s_comment(lut.cmnt[cmntidx]);
	}
	//          0x100000 warning

	if(zidx > -1) numbers_format_cell(ret, t | (5<<8), fields >> 13, lut.ofmt[zidx], lut.nfmt[zidx] );
	if(t == 7) (ret.v as number) /= 86400; // duration -> SheetJS absolute time
	return ret;
}

/** Write a cell "new storage" (version 5) */
function write_new_storage(cell: CellObject, lut: DataLUT): Uint8Array {
	var out = new Uint8Array(32), dv = u8_to_dataview(out), l = 12, fields = 0;
	out[0] = 5;
	switch(cell.t) {
		case "n": if(cell.z && fmt_is_date(cell.z)) {
			out[1] = 5; dv.setFloat64(l, ((numdate((cell.v as number) + 1462)).getTime() - Date.UTC(2001, 0, 1))/1000, true); fields |= 4; l += 8; break
		} else {
			out[1] = 2; writeDecimal128LE(out, l, cell.v as number); fields |= 1; l += 16;
		} break
		case "b": out[1] = 6; dv.setFloat64(l, cell.v ? 1 : 0, true); fields |= 2; l += 8; break;
		case "s": {
			var s = cell.v == null ? "" : String(cell.v);
			if(cell.l) {
				var irsst = lut.rsst.findIndex(v => v.v == s && v.l == cell.l?.Target);
				if(irsst == -1) lut.rsst[irsst = lut.rsst.length] = { v: s , l: cell.l.Target };
				out[1] = 9; dv.setUint32(l, irsst, true); fields |= 0x10; l += 4;
			} else {
				var isst = lut.sst.indexOf(s);
				if(isst == -1) lut.sst[isst = lut.sst.length] = s;
				out[1] = 3; dv.setUint32(l, isst, true); fields |= 8; l += 4;
			}
		} break;
		case "d": out[1] = 5; dv.setFloat64(l, ((cell.v as Date).getTime() - Date.UTC(2001, 0, 1))/1000, true); fields |= 4; l += 8; break;

		case "z": out[1] = 0; break;
		default: throw "unsupported cell type " + cell.t;
	}
	if(cell.c) {
		lut.cmnt.push(s5s_to_iwa_comment(cell.c));
		dv.setUint32(l, lut.cmnt.length - 1, true); fields |= 0x80000; l += 4;
	}
	dv.setUint32(8, fields, true);
	return out[subarray](0, l);
}
/** Write a cell "old storage" (version 4) */
function write_old_storage(cell: CellObject, lut: DataLUT): Uint8Array {
	var out = new Uint8Array(32), dv = u8_to_dataview(out), l = 12, fields = 0, s = "";
	out[0] = 4;
	/* note: rich text appears *before* comments */
	switch(cell.t) {
		case "n": break;
		case "b": break;
		case "s": {
			s = cell.v == null ? "" : String(cell.v);
			if(cell.l) {
				var irsst = lut.rsst.findIndex(v => v.v == s && v.l == cell.l?.Target);
				if(irsst == -1) lut.rsst[irsst = lut.rsst.length] = { v: s, l: cell.l.Target };
				out[1] = 9; dv.setUint32(l, irsst, true); fields |= 0x200; l += 4;
			} else { }
		} break;
		case "d": break;
		case "e": break;
		case "z": break;
		default: throw "unsupported cell type " + cell.t;
	}
	if(cell.c) {
		/* NOTE: THIS ASSUMES write_new_storage was called */
		dv.setUint32(l, lut.cmnt.length - 1, true); fields |= 0x1000; l += 4;
	}
	switch(cell.t) {
		case "n": out[1] = 2; dv.setFloat64(l, cell.v as number, true); fields |= 0x20; l += 8; break;
		case "b": out[1] = 6; dv.setFloat64(l, cell.v ? 1 : 0, true); fields |= 0x20; l += 8; break;
		case "s": {
			s = cell.v == null ? "" : String(cell.v);
			if(cell.l) { } else {
				var isst = lut.sst.indexOf(s);
				if(isst == -1) lut.sst[isst = lut.sst.length] = s;
				out[1] = 3; dv.setUint32(l, isst, true); fields |= 0x10; l += 4;
			}
		} break;
		case "d": out[1] = 5; dv.setFloat64(l, ((cell.v as Date).getTime() - Date.UTC(2001, 0, 1))/1000, true); fields |= 0x40; l += 8; break;
		case "z": out[1] = 0; break;
		default: throw "unsupported cell type " + cell.t;
	}
	dv.setUint32(8, fields, true);
	return out[subarray](0, l);
}
//<<export { write_new_storage, write_old_storage };
function parse_cell_storage(buf: Uint8Array, lut: DataLUT, opts?: ParsingOptions): CellObject | void {
	switch(buf[0]) {
		case 0: case 1:
		case 2: case 3: case 4: return parse_old_storage(buf, lut, buf[0], opts);
		case 5: return parse_new_storage(buf, lut, opts);
		default: throw new Error(`Unsupported payload version ${buf[0]}`);
	}
}

/** .TSS.StylesheetArchive */
//function parse_TSS_StylesheetArchive(M: IWAMessage[][], root: IWAMessage): void {
//	var pb = parse_shallow(root.data);
//}

/** Parse .TSP.Reference */
function parse_TSP_Reference(buf: Uint8Array): number {
	var pb = parse_shallow(buf);
	return varint_to_i32(pb[1][0].data);
}
/** Write .TSP.Reference */
function write_TSP_Reference(idx: number): Uint8Array {
	return write_shallow([ [],
		[ { type: 0, data: write_varint49(idx) } ]
	]);
}
//<<export { parse_TSP_Reference, write_TSP_Reference };

/** Insert Object Reference */
function numbers_add_oref(iwa: IWAArchiveInfo, ref: number): void {
	var orefs: number[] = iwa.messages[0].meta[5]?.[0] ? parse_packed_varints(iwa.messages[0].meta[5][0].data) : [];
	var orefidx = orefs.indexOf(ref);
	if(orefidx == -1) {
		orefs.push(ref);
		iwa.messages[0].meta[5] =[ {type: 2, data: write_packed_varints(orefs) }];
	}
}
/** Delete Object Reference */
function numbers_del_oref(iwa: IWAArchiveInfo, ref: number): void {
	var orefs: number[] = iwa.messages[0].meta[5]?.[0] ? parse_packed_varints(iwa.messages[0].meta[5][0].data) : [];
	iwa.messages[0].meta[5] =[ {type: 2, data: write_packed_varints(orefs.filter(r => r != ref)) }];
}

type MessageSpace = {[id: number]: IWAMessage[]};

/** Parse .TST.TableDataList */
function parse_TST_TableDataList(M: MessageSpace, root: IWAMessage): any[] {
	var pb = parse_shallow(root.data);
	// .TST.TableDataList.ListType
	var type = varint_to_i32(pb[1][0].data);

	var entries = pb[3];
	var data: any[] = [];
	(entries||[]).forEach(entry => {
		// .TST.TableDataList.ListEntry
		var le = parse_shallow(entry.data);
		if(!le[1]) return; // sometimes the list has a spurious entry at index 0
		var key = varint_to_i32(le[1][0].data)>>>0;
		switch(type) {
			case 1: data[key] = u8str(le[3][0].data); break;
			case 8: {
				// .TST.RichTextPayloadArchive
				var rt = M[parse_TSP_Reference(le[9][0].data)][0];
				var rtp = parse_shallow(rt.data);

				// .TSWP.StorageArchive
				var rtpref = M[parse_TSP_Reference(rtp[1][0].data)][0];
				var mtype = varint_to_i32(rtpref.meta[1][0].data);
				if(mtype != 2001) throw new Error(`2000 unexpected reference to ${mtype}`);
				var tswpsa = parse_shallow(rtpref.data);

				var richtext: RichText = { v: tswpsa[3].map(x => u8str(x.data)).join("") };
				data[key] = richtext;

				/* NOTE: NUMBERS rich text styling is spiritually similar to XLS */
				sfields: if(tswpsa?.[11]?.[0]) {
					// .TSWP.ObjectAttributeTable
					var smartfields = parse_shallow(tswpsa[11][0].data)?.[1];
					if(!smartfields) break sfields;
					smartfields.forEach(sf => {
						// .TSWP.ObjectAttributeTable.ObjectAttribute
						var attr = parse_shallow(sf.data);
						if(attr[2]?.[0]) {
							var obj = M[parse_TSP_Reference(attr[2]?.[0].data)][0];
							var objtype = varint_to_i32(obj.meta[1][0].data);
							switch(objtype) {
								case 2032: // .TSWP.HyperlinkFieldArchive
									var hlink = parse_shallow(obj.data);
									/* TODO: once run-level links are supported, fix this cell assignment */
									if(hlink?.[2]?.[0] && !richtext.l) richtext.l = u8str(hlink[2][0].data);
									break;
								case 2039: // .TSWP.UnsupportedHyperlinkFieldArchive
									/* TODO: "Sheet" internal links */
									break;
								default: console.log(`unrecognized ObjectAttribute type ${objtype}`);
							}
						}
					});
				}
			} break;
			case 2: data[key] = parse_shallow(le[6][0].data); break;
			case 3: data[key] = parse_shallow(le[5][0].data); break;
			case 10: {
				// .TSD.CommentStorageArchive
				var cs = M[parse_TSP_Reference(le[10][0].data)][0];
				data[key] = parse_TSD_CommentStorageArchive(M, cs.data);
			} break;
			default: throw type;
		}
	});
	return data;
}

type TileStorageType = -1 | 0 | 1;
interface TileRowInfo {
	/** Row Index */
	R: number;
	/** Cell Storage */
	cells: Uint8Array[];
}
/** Parse .TSP.TileRowInfo */
function parse_TST_TileRowInfo(u8: Uint8Array, type: TileStorageType): TileRowInfo {
	var pb = parse_shallow(u8);
	var R = varint_to_i32(pb[1][0].data) >>> 0;
	var cnt = varint_to_i32(pb[2][0].data) >>> 0;
	// var version = pb?.[5]?.[0] && (varint_to_i32(pb[5][0].data) >>> 0);
	var wide_offsets = pb[8]?.[0]?.data && varint_to_i32(pb[8][0].data) > 0 || false;

	/* select storage by type (1 = modern / 0 = old / -1 = try modern, old) */
	var used_storage_u8: Uint8Array, used_storage: Uint8Array;
	if(pb[7]?.[0]?.data && type != 0) { used_storage_u8 = pb[7]?.[0]?.data; used_storage = pb[6]?.[0]?.data; }
	else if(pb[4]?.[0]?.data && type != 1) { used_storage_u8 = pb[4]?.[0]?.data; used_storage = pb[3]?.[0]?.data; }
	else throw `NUMBERS Tile missing ${type} cell storage`;

	/* find all offsets -- 0xFFFF means cells are not present */
	var width = wide_offsets ? 4 : 1;
	var used_storage_offsets = u8_to_dataview(used_storage_u8);
	var offsets: Array<[number, number]> = [];
	for(var C = 0; C < used_storage_u8.length / 2; ++C) {
		var off = used_storage_offsets.getUint16(C*2, true);
		if(off < 65535) offsets.push([C, off]);
	}
	if(offsets.length != cnt) throw `Expected ${cnt} cells, found ${offsets.length}`;

	var cells: Uint8Array[] = [];
	for(C = 0; C < offsets.length - 1; ++C) cells[offsets[C][0]] = used_storage[subarray](offsets[C][1] * width, offsets[C+1][1] * width);
	if(offsets.length >= 1) cells[offsets[offsets.length - 1][0]] = used_storage[subarray](offsets[offsets.length - 1][1] * width);
	return { R, cells };
}

interface TileInfo {
	data: Uint8Array[][];
	nrows: number;
}
/** Parse .TST.Tile */
function parse_TST_Tile(M: MessageSpace, root: IWAMessage): TileInfo {
	var pb = parse_shallow(root.data);
	// ESBuild issue 2136
	// 	var storage: TileStorageType = (pb?.[7]?.[0]) ? ((varint_to_i32(pb[7][0].data)>>>0) > 0 ? 1 : 0 ) : -1;
	var storage: TileStorageType = -1;
	if(pb?.[7]?.[0]) { if(varint_to_i32(pb[7][0].data)>>>0) storage = 1; else storage = 0; }
	var ri = mappa(pb[5], (u8: Uint8Array) => parse_TST_TileRowInfo(u8, storage));
	return {
		nrows: varint_to_i32(pb[4][0].data)>>>0,
		data: ri.reduce((acc, x) => {
			if(!acc[x.R]) acc[x.R] = [];
			x.cells.forEach((cell, C) => {
				if(acc[x.R][C]) throw new Error(`Duplicate cell r=${x.R} c=${C}`);
				acc[x.R][C] = cell;
			});
			return acc;
		}, [] as Uint8Array[][])
	};
}

/** Parse .TSD.CommentStorageArchive (3056) */
function parse_TSD_CommentStorageArchive(M: MessageSpace, data: Uint8Array): IWAComment {
	var out: IWAComment = { t: "", a: ""};
	var csp = parse_shallow(data);
	if(csp?.[1]?.[0]?.data) out.t = u8str(csp?.[1]?.[0]?.data) || "";
	if(csp?.[3]?.[0]?.data) {
		/* .TSK.AnnotationAuthorArchive (212) */
		var as = M[parse_TSP_Reference(csp?.[3]?.[0]?.data)][0];
		var asp = parse_shallow(as.data);
		if(asp[1]?.[0]?.data) out.a = u8str(asp[1][0].data)
	}
	if(csp?.[4]) {
		out.replies = [];
		csp[4].forEach(pi => {
			var cs = M[parse_TSP_Reference(pi.data)][0];
			out.replies!.push(parse_TSD_CommentStorageArchive(M, cs.data));
		});
	}
	return out;
}
/** Create SheetJS threaded comment structure from IWA comment */
function iwa_to_s5s_comment(iwa: IWAComment): Comments {
	var out: Comments = [];
	out.push({t: iwa.t||"", a: iwa.a, T: iwa.replies && (iwa.replies.length > 0) });
	/* TODO: do apps support a tree of replies? */
	if(iwa.replies) iwa.replies.forEach(reply => {
		out.push({t: reply.t ||"", a: reply.a, T:true });
	});
	return out;
}
/** Create IWA comment from SheetJS threaded comment structure */
function s5s_to_iwa_comment(s5s: Comments): IWAComment {
	var out: IWAComment = {a: "", t:"", replies:[]};
	for(var i = 0; i < s5s.length; ++i) {
		if(i == 0) { out.a = s5s[i].a; out.t = s5s[i].t; }
		else {
			out.replies!.push({a: s5s[i].a, t: s5s[i].t});
		}
	}
	return out;
}

/** Parse .TST.TableModelArchive (6001) */
function parse_TST_TableModelArchive(M: MessageSpace, root: IWAMessage, ws: WorkSheet, opts?: ParsingOptions) {
	var pb = parse_shallow(root.data);
	var range: Range = { s: {r:0, c:0}, e: {r:0, c:0} };
	range.e.r = (varint_to_i32(pb[6][0].data) >>> 0) - 1;
	if(range.e.r < 0) throw new Error(`Invalid row varint ${pb[6][0].data}`);
	range.e.c = (varint_to_i32(pb[7][0].data) >>> 0) - 1;
	if(range.e.c < 0) throw new Error(`Invalid col varint ${pb[7][0].data}`);
	ws["!ref"] = encode_range(range);
	var dense = ws["!data"] != null, dws = (ws as DenseWorkSheet);
	// .TST.DataStore
	var store = parse_shallow(pb[4][0].data);
	var lut: DataLUT = numbers_lut_new();
	if(store[4]?.[0])  lut.sst  = parse_TST_TableDataList(M, M[parse_TSP_Reference(store[4][0].data)][0]);
	if(store[6]?.[0])  lut.fmla = parse_TST_TableDataList(M, M[parse_TSP_Reference(store[6][0].data)][0]);
	if(store[11]?.[0]) lut.ofmt = parse_TST_TableDataList(M, M[parse_TSP_Reference(store[11][0].data)][0]);
	if(store[12]?.[0]) lut.ferr = parse_TST_TableDataList(M, M[parse_TSP_Reference(store[12][0].data)][0]);
	if(store[17]?.[0]) lut.rsst = parse_TST_TableDataList(M, M[parse_TSP_Reference(store[17][0].data)][0]);
	if(store[19]?.[0]) lut.cmnt = parse_TST_TableDataList(M, M[parse_TSP_Reference(store[19][0].data)][0]);
	if(store[22]?.[0]) lut.nfmt = parse_TST_TableDataList(M, M[parse_TSP_Reference(store[22][0].data)][0]);

	// .TST.TileStorage
	var tile = parse_shallow(store[3][0].data);
	var _R = 0;
	/* TODO: should this list be sorted by id ? */
	tile[1].forEach(t => {
		var tl = (parse_shallow(t.data));
		// var id = varint_to_i32(tl[1][0].data);
		var ref = M[parse_TSP_Reference(tl[2][0].data)][0];
		var mtype = varint_to_i32(ref.meta[1][0].data);
		if(mtype != 6002) throw new Error(`6001 unexpected reference to ${mtype}`);
		var _tile = parse_TST_Tile(M, ref);
		_tile.data.forEach((row, R) => {
			row.forEach((buf, C) => {
				var res = parse_cell_storage(buf, lut, opts);
				if(res) {
					if(dense) {
						if(!dws["!data"][_R + R]) dws["!data"][_R + R] = [];
						dws["!data"][_R + R][C] = res;
					} else {
						ws[encode_col(C) + encode_row(_R + R)] = res;
					}
				}
			});
		});
		_R += _tile.nrows;
	});

	if(store[13]?.[0]) {
		var ref = M[parse_TSP_Reference(store[13][0].data)][0];
		var mtype = varint_to_i32(ref.meta[1][0].data);
		if(mtype != 6144) throw new Error(`Expected merge type 6144, found ${mtype}`);
		ws["!merges"] = parse_shallow(ref.data)?.[1].map(pi => {
			var merge = parse_shallow(pi.data);
			var origin = u8_to_dataview(parse_shallow(merge[1][0].data)[1][0].data), size = u8_to_dataview(parse_shallow(merge[2][0].data)[1][0].data);
			return {
				s: { r: origin.getUint16(0, true), c: origin.getUint16(2, true) },
				e: {
					r: origin.getUint16(0, true) + size.getUint16(0, true) - 1,
					c: origin.getUint16(2, true) + size.getUint16(2, true) - 1
				}
			};
		});
	}
}

/** Parse .TST.TableInfoArchive (6000) */
function parse_TST_TableInfoArchive(M: MessageSpace, root: IWAMessage, opts?: ParsingOptions): WorkSheet {
	var pb = parse_shallow(root.data);
	// ESBuild #2375
	var out: WorkSheet = { "!ref": "A1" };
	if(opts?.dense) (out as DenseWorkSheet)["!data"] = [];
	var tableref = M[parse_TSP_Reference(pb[2][0].data)];
	var mtype = varint_to_i32(tableref[0].meta[1][0].data);
	if(mtype != 6001) throw new Error(`6000 unexpected reference to ${mtype}`);
	parse_TST_TableModelArchive(M, tableref[0], out, opts);
	return out;
}

interface NSheet {
	name: string;
	sheets: WorkSheet[];
}
/** Parse .TN.SheetArchive (2) */
function parse_TN_SheetArchive(M: MessageSpace, root: IWAMessage, opts?: ParsingOptions): NSheet {
	var pb = parse_shallow(root.data);
	var out: NSheet = {
		name: (pb[1]?.[0] ? u8str(pb[1][0].data) : ""),
		sheets: []
	};
	var shapeoffs = mappa(pb[2], parse_TSP_Reference);
	shapeoffs.forEach((off) => {
		M[off].forEach((m: IWAMessage) => {
			var mtype = varint_to_i32(m.meta[1][0].data);
			if(mtype == 6000) out.sheets.push(parse_TST_TableInfoArchive(M, m, opts));
		});
	});
	return out;
}

/** Parse .TN.DocumentArchive */
function parse_TN_DocumentArchive(M: MessageSpace, root: IWAMessage, opts?: ParsingOptions): WorkBook {
	var out = book_new();
	out.Workbook = { WBProps: { date1904: true } };
	var pb = parse_shallow(root.data);
	if(pb[2]?.[0]) throw new Error("Keynote presentations are not supported");

	// var stylesheet = mappa(pb[4], parse_TSP_Reference)[0];
	// if(varint_to_i32(M[stylesheet][0].meta[1][0].data) == 401) parse_TSS_StylesheetArchive(M, M[stylesheet][0]);
	// var sidebar = mappa(pb[5], parse_TSP_Reference);
	// var theme = mappa(pb[6], parse_TSP_Reference);
	// var docinfo = parse_shallow(pb[8][0].data);
	// var tskinfo = parse_shallow(docinfo[1][0].data);
	// var author_storage = mappa(tskinfo[7], parse_TSP_Reference);

	var sheetoffs = mappa(pb[1], parse_TSP_Reference);
	sheetoffs.forEach((off) => {
		M[off].forEach((m: IWAMessage) => {
			var mtype = varint_to_i32(m.meta[1][0].data);
			if(mtype == 2) {
				var root = parse_TN_SheetArchive(M, m, opts);
				root.sheets.forEach((sheet, idx) => { book_append_sheet(out, sheet, idx == 0 ? root.name : root.name + "_" + idx, true); });
			}
		});
	});
	if(out.SheetNames.length == 0) throw new Error("Empty NUMBERS file");
	out.bookType = "numbers";
	return out;
}

/** Parse NUMBERS file */
function parse_numbers_iwa(cfb: CFB$Container, opts?: ParsingOptions ): WorkBook {
	var M: MessageSpace = {}, indices: number[] = [];
	cfb.FullPaths.forEach(p => { if(p.match(/\.iwpv2/)) throw new Error(`Unsupported password protection`); });

	/* collect entire message space */
	cfb.FileIndex.forEach(s => {
		if(!s.name.match(/\.iwa$/)) return;
		if(s.content[0] != 0) return; // TODO: this should test if the iwa follows the framing format
		var o: Uint8Array;
		try { o = decompress_iwa_file(s.content as Uint8Array); } catch(e: any) { return console.log("?? " + s.content.length + " " + ((e as Error).message || e)); }
		var packets: IWAArchiveInfo[];
		try { packets = parse_iwa_file(o); } catch(e: any) { return console.log("## " + ((e as Error).message || e)); }
		packets.forEach(packet => { M[packet.id] = packet.messages; indices.push(packet.id); });
	});
	if(!indices.length) throw new Error("File has no messages");

	/* find document root */
	if(M?.[1]?.[0].meta?.[1]?.[0].data && varint_to_i32(M[1][0].meta[1][0].data) == 10000) throw new Error("Pages documents are not supported");
	var docroot: IWAMessage | false = M?.[1]?.[0]?.meta?.[1]?.[0].data && varint_to_i32(M[1][0].meta[1][0].data) == 1 && M[1][0];
	if(!docroot) indices.forEach((idx) => {
		M[idx].forEach((iwam) => {
			var mtype = varint_to_i32(iwam.meta[1][0].data) >>> 0;
			if(mtype == 1) {
				if(!docroot) docroot = iwam;
				else throw new Error("Document has multiple roots");
			}
		});
	});
	if(!docroot) throw new Error("Cannot find Document root");
	return parse_TN_DocumentArchive(M, docroot, opts);
}

//<<export { parse_numbers_iwa };

interface DependentInfo {
	deps: number[];
	location: string;
	type: number;
}
/** Write .TST.TileRowInfo */
function write_TST_TileRowInfo(data: CellObject[], lut: DataLUT, wide: boolean): ProtoMessage {
	var tri: ProtoMessage = [
		[],
		[ { type: 0, data: write_varint49(0) }],
		[ { type: 0, data: write_varint49(0) }],
		[ { type: 2, data: new Uint8Array([]) }],
		[ { type: 2, data: new Uint8Array(Array.from({length:510}, () => 255)) }],
		[ { type: 0, data: write_varint49(5) }],
		[ { type: 2, data: new Uint8Array([]) }],
		[ { type: 2, data: new Uint8Array(Array.from({length:510}, () => 255)) }],
		[ { type: 0, data: write_varint49(1) }],
	] as ProtoMessage;
	if(!tri[6]?.[0] || !tri[7]?.[0]) throw "Mutation only works on post-BNC storages!";
	//var wide_offsets = tri[8]?.[0]?.data && varint_to_i32(tri[8][0].data) > 0 || false;
	var cnt = 0;
	if(tri[7][0].data.length < 2 * data.length) {
		var new_7 = new Uint8Array(2 * data.length);
		new_7.set(tri[7][0].data);
		tri[7][0].data = new_7;
	}
	//if(wide) {
	//	tri[3] = [{type: 2, data: new Uint8Array([240, 159, 164, 160]) }];
	//	tri[4] = [{type: 2, data: new Uint8Array([240, 159, 164, 160]) }];
	/* } else*/ if(tri[4][0].data.length < 2 * data.length) {
		var new_4 = new Uint8Array(2 * data.length);
		new_4.set(tri[4][0].data);
		tri[4][0].data = new_4;
	}
	var dv = u8_to_dataview(tri[7][0].data), last_offset = 0, cell_storage: Uint8Array[] = [];
	var _dv = u8_to_dataview(tri[4][0].data), _last_offset = 0, _cell_storage: Uint8Array[] = [];
	var width = wide ? 4 : 1;
	for(var C = 0; C < data.length; ++C) {
		/* TODO: serialize errors */
		if(data[C] == null || (data[C].t == "z" && !data[C].c?.length) || data[C].t == "e") { dv.setUint16(C*2, 0xFFFF, true); _dv.setUint16(C*2, 0xFFFF); continue; }
		dv.setUint16(C*2, last_offset / width, true);
		/*if(!wide)*/ _dv.setUint16(C*2, _last_offset / width, true);
		var celload: Uint8Array, _celload: Uint8Array;
		switch(data[C].t) {
			case "d":
				if(data[C].v instanceof Date) {
					celload = write_new_storage(data[C], lut);
					/*if(!wide)*/ _celload = write_old_storage(data[C], lut);
					break;
				}
				/* TODO: can esbuild preserve falls through comments ? */
				celload = write_new_storage(data[C], lut);
				/*if(!wide)*/ _celload = write_old_storage(data[C], lut);
				break;
			case "s": case "n": case "b": case "z":
				celload = write_new_storage(data[C], lut);
				/*if(!wide)*/ _celload = write_old_storage(data[C], lut);
				break;
			default:
				throw new Error("Unsupported value " + data[C]);
		}
		cell_storage.push(celload); last_offset += celload.length;
		/*if(!wide)*/ { _cell_storage.push(_celload); _last_offset += _celload.length; }
		++cnt;
	}
	tri[2][0].data = write_varint49(cnt);
	tri[5][0].data = write_varint49(5);

	for(; C < tri[7][0].data.length/2; ++C) {
		dv.setUint16(C*2, 0xFFFF, true);
		/*if(!wide)*/ _dv.setUint16(C*2, 0xFFFF, true);
	}
	tri[6][0].data = u8concat(cell_storage);
	/*if(!wide)*/ tri[3][0].data = u8concat(_cell_storage);
	tri[8] = [{type: 0, data: write_varint49(wide ? 1 : 0)}];
	return tri;
}

/** Write IWA Message */
function write_iwam(type: number, payload: Uint8Array): IWAMessage {
	return {
		meta: [ [],
			[ { type: 0, data: write_varint49(type) } ],
			// [ { type: 2, data: new Uint8Array([1, 0, 5]) }]
		],
		data: payload
	};
}

type Dependents = {[x:number]: DependentInfo; last?: number;};

function get_unique_msgid(dep: DependentInfo, dependents: Dependents) {
	if(!dependents.last) dependents.last = 927262;
	for(var i = dependents.last; i < 2000000; ++i) if(!dependents[i]) {
		dependents[dependents.last = i] = dep;
		return i;
	}
	throw new Error("Too many messages");
}

/** Build an approximate dependency tree */
function build_numbers_deps(cfb: CFB$Container): Dependents {
	var dependents: Dependents = {};
	var indices: number[] = [];

	cfb.FileIndex.map((fi, idx): [CFB$Entry, string] => ([fi, cfb.FullPaths[idx]])).forEach(row => {
		var fi = row[0], fp = row[1];
		if(fi.type != 2) return;
		if(!fi.name.match(/\.iwa/)) return;
		if((fi.content as Uint8Array)[0] != 0) return; // TODO: this should test if the iwa follows the framing format

		parse_iwa_file(decompress_iwa_file(fi.content as Uint8Array)).forEach(packet => {
			indices.push(packet.id);
			dependents[packet.id] = { deps: [], location: fp, type: varint_to_i32(packet.messages[0].meta[1][0].data) };
		});
	});

	/* build dependent tree */
	cfb.FileIndex.forEach(fi => {
		if(!fi.name.match(/\.iwa/)) return;
		if((fi.content as Uint8Array)[0] != 0) return; // TODO: this should test if the iwa follows the framing format
		parse_iwa_file(decompress_iwa_file(fi.content as Uint8Array)).forEach(ia => {
			ia.messages.forEach(mess => {
				[5,6].forEach(f => {
					if(!mess.meta[f]) return;
					mess.meta[f].forEach(x => {
						dependents[ia.id].deps.push(varint_to_i32(x.data));
					});
				});
			});
		});
	});
	return dependents;
}

/** Generate .TSP.Color from r/g/b (0-255) */
function write_TSP_Color_RGB(r: number, g: number, b: number): Uint8Array { return write_shallow([[],
	[{ type: 0, data: write_varint49(1) }],
	[],
	[{ type: 5, data: new Uint8Array(Float32Array.from([r/255]).buffer)}],
	[{ type: 5, data: new Uint8Array(Float32Array.from([g/255]).buffer)}],
	[{ type: 5, data: new Uint8Array(Float32Array.from([b/255]).buffer)}],
	[{ type: 5, data: new Uint8Array(Float32Array.from([1]).buffer)}],
	[], [], [], [], [],
	[{ type: 0, data: write_varint49(1) }]
]); }

function get_author_color(n: number): Uint8Array {
	switch(n) {
		case 0: return write_TSP_Color_RGB(0x63, 0xDE, 0xAB);
		case 1: return write_TSP_Color_RGB(0xA2, 0xC5, 0xF0);
		case 2: return write_TSP_Color_RGB(0xFF, 0xBD, 0xBD);
	}
	return write_TSP_Color_RGB(Math.random()*255, Math.random()*255, Math.random()*255);
}

/** Write NUMBERS workbook */
function write_numbers_iwa(wb: WorkBook, opts?: WritingOptions): CFB$Container {
	if(!opts || !opts.numbers) throw new Error("Must pass a `numbers` option -- check the README");

	/* read template and build packet metadata */
	var cfb: CFB$Container = CFB.read(opts.numbers, { type: "base64" });
	var deps: Dependents = build_numbers_deps(cfb);

	/* .TN.DocumentArchive */
	var docroot: IWAArchiveInfo = numbers_iwa_find(cfb, deps, 1);
	if(docroot == null) throw `Could not find message ${1} in Numbers template`;
	var sheetrefs = mappa(parse_shallow(docroot.messages[0].data)[1], parse_TSP_Reference);
	if(sheetrefs.length > 1) throw new Error("Template NUMBERS file must have exactly one sheet")
	wb.SheetNames.forEach((name, idx) => {
		if(idx >= 1) {
			numbers_add_ws(cfb, deps, idx + 1);
			docroot = numbers_iwa_find(cfb, deps, 1);
			sheetrefs = mappa(parse_shallow(docroot.messages[0].data)[1], parse_TSP_Reference);
		}
		write_numbers_ws(cfb, deps, wb.Sheets[name], name, idx, sheetrefs[idx])
	});
	return cfb;
}

/** Find a particular message by ID, perform actions and commit */
function numbers_iwa_doit(cfb: CFB$Container, deps: Dependents, id: number, cb:(ai:IWAArchiveInfo, x:IWAArchiveInfo[])=>void) {
	var entry = CFB.find(cfb, deps[id].location);
	if(!entry) throw `Could not find ${deps[id].location} in Numbers template`;
	var x = parse_iwa_file(decompress_iwa_file(entry.content as Uint8Array));
	var ainfo: IWAArchiveInfo = x.find(packet => packet.id == id) as IWAArchiveInfo;
	// TODO: it's assumed this exists
	cb(ainfo, x);
	entry.content = compress_iwa_file(write_iwa_file(x)); entry.size = entry.content.length;
}

/** Find a particular message by ID */
function numbers_iwa_find(cfb: CFB$Container, deps: Dependents, id: number) {
	var entry = CFB.find(cfb, deps[id].location);
	if(!entry) throw `Could not find ${deps[id].location} in Numbers template`;
	var x = parse_iwa_file(decompress_iwa_file(entry.content as Uint8Array));
	var ainfo: IWAArchiveInfo = x.find(packet => packet.id == id) as IWAArchiveInfo;
	// TODO: it's assumed this exists
	return ainfo;
}

function numbers_add_meta(mlist: ProtoMessage, newid: number, newloc: string) {
	mlist[3].push({type: 2, data: write_shallow([ [],
		[{type: 0, data: write_varint49(newid)}],
		[{type: 2, data: stru8(newloc.replace(/-.*$/, "")) }],
		[{type: 2, data: stru8(newloc)}],
		[{type: 2, data: new Uint8Array([2, 0, 0])}],
		[{type: 2, data: new Uint8Array([2, 0, 0])}],
		[], [], [], [], // skip fields 6-9
		[{type: 0, data: write_varint49(0)}],
		[],
		[{type: 0, data: write_varint49(0 /* TODO: save_token */)}],
	])});
	mlist[1] = [{type: 0, data: write_varint49(Math.max(newid + 1, varint_to_i32(mlist[1][0].data) ))}];
}

function numbers_add_msg(cfb: CFB$Container, type: number, msg: ProtoMessage, path: string, deps: Dependents, id?: number): number {
	if(!id) id = get_unique_msgid({ deps: [], location: "", type }, deps);
	var loc = `${path}-${id}.iwa`;
	deps[id].location = "Root Entry" + loc;
	CFB.utils.cfb_add(cfb, loc, compress_iwa_file(write_iwa_file([{
		id,
		messages: [ write_iwam(type, write_shallow(msg)) ]
	}])));
	var newloc = loc.replace(/^[\/]/, "").replace(/^Index\//, "").replace(/\.iwa$/,"");
	numbers_iwa_doit(cfb, deps, 2, ai => {
		var mlist = parse_shallow(ai.messages[0].data);
		numbers_add_meta(mlist, id||0, newloc);

		ai.messages[0].data = write_shallow(mlist);
	})
	return id;
}

/** Add dependency to metadata */
function numbers_meta_add_dep(mlist: ProtoMessage, deps: Dependents, id: number, dep: number|number[]) {
	var loc = deps[id].location.replace(/^Root Entry\//,"").replace(/^Index\//, "").replace(/\.iwa$/,"");
	var parentidx = mlist[3].findIndex(m => {
		var mm = parse_shallow(m.data);
		if(mm[3]?.[0]) return u8str(mm[3][0].data) == loc;
		if(mm[2]?.[0] && u8str(mm[2][0].data) == loc) return true;
		return false;
	});
	var parent = parse_shallow(mlist[3][parentidx].data);
	if(!parent[6]) parent[6] = [];
	(Array.isArray(dep) ? dep : [dep]).forEach(dep => {
		parent[6].push({
			type: 2,
			data: write_shallow([ [],
				[{type: 0, data: write_varint49(dep) }]
			])
		});
	});
	mlist[3][parentidx].data = write_shallow(parent);
}

/** Remove dependency from metadata */
function numbers_meta_del_dep(mlist: ProtoMessage, deps: Dependents, id: number, dep: number|number[]) {
	var loc = deps[id].location.replace(/^Root Entry\//,"").replace(/^Index\//, "").replace(/\.iwa$/,"");
	var parentidx = mlist[3].findIndex(m => {
		var mm = parse_shallow(m.data);
		if(mm[3]?.[0]) return u8str(mm[3][0].data) == loc;
		if(mm[2]?.[0] && u8str(mm[2][0].data) == loc) return true;
		return false;
	});
	var parent = parse_shallow(mlist[3][parentidx].data);
	if(!parent[6]) parent[6] = [];
	parent[6] = parent[6].filter(m => varint_to_i32(parse_shallow(m.data)[1][0].data) != dep);
	mlist[3][parentidx].data = write_shallow(parent);
}

/** Deep copy of the essential parts of a worksheet */
function numbers_add_ws(cfb: CFB$Container, deps: Dependents, wsidx: number) {
	var sheetref = -1, newsheetref = -1;

	var remap: {[x: number]: number} = {};
	/* .TN.DocumentArchive -> new .TN.SheetArchive */
	numbers_iwa_doit(cfb, deps, 1, (docroot: IWAArchiveInfo, arch: IWAArchiveInfo[]) => {
		var doc = parse_shallow(docroot.messages[0].data);

		/* new sheet reference */
		sheetref = parse_TSP_Reference(parse_shallow(docroot.messages[0].data)[1][0].data);
		newsheetref = get_unique_msgid({ deps: [1], location: deps[sheetref].location, type: 2 }, deps);
		remap[sheetref] = newsheetref;

		/* connect root -> sheet */
		numbers_add_oref(docroot, newsheetref);
		doc[1].push({ type: 2, data: write_TSP_Reference(newsheetref) });

		/* copy sheet */
		var sheet = numbers_iwa_find(cfb, deps, sheetref);
		sheet.id = newsheetref;
		if(deps[1].location == deps[newsheetref].location) arch.push(sheet);
		else numbers_iwa_doit(cfb, deps, newsheetref, (_, x) => x.push(sheet));

		docroot.messages[0].data = write_shallow(doc);
	});

	/* .TN.SheetArchive -> new .TST.TableInfoArchive */
	var tiaref = -1;
	numbers_iwa_doit(cfb, deps, newsheetref, (sheetroot: IWAArchiveInfo, arch: IWAArchiveInfo[]) => {
		var sa = parse_shallow(sheetroot.messages[0].data);

		/* remove everything except for name and drawables */
		for(var i = 3; i <= 69; ++i) delete sa[i];
		/* remove all references to drawables */
		var drawables = mappa(sa[2], parse_TSP_Reference);
		drawables.forEach(n => numbers_del_oref(sheetroot, n));

		/* add new tia reference */
		tiaref = get_unique_msgid({ deps: [newsheetref], location: deps[drawables[0]].location, type: deps[drawables[0]].type }, deps);
		numbers_add_oref(sheetroot, tiaref);
		remap[drawables[0]] = tiaref;
		sa[2] = [ { type: 2, data: write_TSP_Reference(tiaref) } ];

		/* copy tia */
		var tia = numbers_iwa_find(cfb, deps, drawables[0]);
		tia.id = tiaref;
		if(deps[drawables[0]].location == deps[newsheetref].location) arch.push(tia);
		else {
			/* TODO: there are a number of places that assume the metadata record has ID=2 */
			numbers_iwa_doit(cfb, deps, 2, (ai => {
				var mlist = parse_shallow(ai.messages[0].data);

				/* add reference from SheetArchive file to TIA */
				numbers_meta_add_dep(mlist, deps, newsheetref, tiaref);

				ai.messages[0].data = write_shallow(mlist);
			}));
			numbers_iwa_doit(cfb, deps, tiaref, (_, x) => x.push(tia));
		}

		sheetroot.messages[0].data = write_shallow(sa);
	});

	/* .TST.TableInfoArchive -> new .TST.TableModelArchive */
	var tmaref = -1;
	numbers_iwa_doit(cfb, deps, tiaref, (tiaroot: IWAArchiveInfo, arch: IWAArchiveInfo[]) => {
		var tia = parse_shallow(tiaroot.messages[0].data);

		/* update parent reference */
		var da = parse_shallow(tia[1][0].data);
		for(var i = 3; i <= 69; ++i) delete da[i];
		var dap = parse_TSP_Reference(da[2][0].data);
		da[2][0].data = write_TSP_Reference(remap[dap]);
		tia[1][0].data = write_shallow(da);

		/* remove old tma reference */
		var oldtmaref = parse_TSP_Reference(tia[2][0].data);
		numbers_del_oref(tiaroot, oldtmaref);

		/* add new tma reference */
		tmaref = get_unique_msgid({ deps: [tiaref], location: deps[oldtmaref].location, type: deps[oldtmaref].type }, deps);
		numbers_add_oref(tiaroot, tmaref);
		remap[oldtmaref] = tmaref;
		tia[2][0].data = write_TSP_Reference(tmaref);

		/* copy tma */
		var tma = numbers_iwa_find(cfb, deps, oldtmaref);
		tma.id = tmaref;
		if(deps[tiaref].location == deps[tmaref].location) arch.push(tma);
		else numbers_iwa_doit(cfb, deps, tmaref, (_, x) => x.push(tma));

		tiaroot.messages[0].data = write_shallow(tia);
	});

	/* .TST.TableModelArchive */
	numbers_iwa_doit(cfb, deps, tmaref, (tmaroot: IWAArchiveInfo, arch: IWAArchiveInfo[]) => {
		/* TODO: formulae currently break due to missing CE details */
		var tma = parse_shallow(tmaroot.messages[0].data);
		var uuid = u8str(tma[1][0].data), new_uuid = uuid.replace(/-[A-Z0-9]*/, `-${("0000" + wsidx.toString(16)).slice(-4)}`);
		tma[1][0].data = stru8(new_uuid);

		/* NOTE: These lists should be revisited every time the template is changed */

		/* bare fields */
		[ 12, 13, 29, 31, 32, 33, 39, 44, 47, 81, 82, 84 ].forEach(n => delete tma[n]);

		if(tma[45]) {
			// .TST.SortRuleReferenceTrackerArchive
			var srrta = parse_shallow(tma[45][0].data);
			var ref = parse_TSP_Reference(srrta[1][0].data);
			numbers_del_oref(tmaroot, ref);
			delete tma[45];
		}

		if(tma[70]) {
			// .TST.HiddenStatesOwnerArchive
			var hsoa = parse_shallow(tma[70][0].data);
			hsoa[2]?.forEach(item => {
				// .TST.HiddenStatesArchive
				var hsa = parse_shallow(item.data);
				[2,3].map(n => hsa[n][0]).forEach(hseadata => {
					// .TST.HiddenStateExtentArchive
					var hsea = parse_shallow(hseadata.data);
					if(!hsea[8]) return;
					var ref = parse_TSP_Reference(hsea[8][0].data);
					numbers_del_oref(tmaroot, ref);
				});
			});
			delete tma[70];
		}

		[ 46, // deleting field 46 (base_column_row_uids) forces Numbers to refresh cell table
			30, 34, 35, 36, 38, 48, 49, 60, 61, 62, 63, 64, 71, 72, 73, 74, 75, 85, 86, 87, 88, 89
		].forEach(n => {
			if(!tma[n]) return;
			var ref = parse_TSP_Reference(tma[n][0].data);
			delete tma[n];
			numbers_del_oref(tmaroot, ref);
		});

		/* update .TST.DataStore */
		var store = parse_shallow(tma[4][0].data);
		{
			/* TODO: actually scan through dep tree and update */

			/* blind copy of single references */
			[ 2, 4, 5, 6, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22 ].forEach(n => {
				if(!store[n]?.[0]) return;
				var oldref = parse_TSP_Reference(store[n][0].data);
				var newref = get_unique_msgid({ deps: [tmaref], location: deps[oldref].location, type: deps[oldref].type }, deps);
				numbers_del_oref(tmaroot, oldref);
				numbers_add_oref(tmaroot, newref);
				remap[oldref] = newref;
				var msg = numbers_iwa_find(cfb, deps, oldref);
				msg.id = newref;
				if(deps[oldref].location == deps[tmaref].location) arch.push(msg);
				else {
					deps[newref].location = deps[oldref].location.replace(oldref.toString(), newref.toString());
					if(deps[newref].location == deps[oldref].location) deps[newref].location = deps[newref].location.replace(/\.iwa/, `-${newref}.iwa`);
					CFB.utils.cfb_add(cfb, deps[newref].location, compress_iwa_file(write_iwa_file([ msg ])));

					var newloc = deps[newref].location.replace(/^Root Entry\//,"").replace(/^Index\//, "").replace(/\.iwa$/,"");

					numbers_iwa_doit(cfb, deps, 2, ai => {
						var mlist = parse_shallow(ai.messages[0].data);
						numbers_add_meta(mlist, newref, newloc);

						/* add reference from TableModelArchive file to Tile */
						numbers_meta_add_dep(mlist, deps, tmaref, newref);

						ai.messages[0].data = write_shallow(mlist);
					});
				}
				store[n][0].data = write_TSP_Reference(newref);
			});

			/* copy row header storage */
			var row_headers = parse_shallow(store[1][0].data);
			{
				row_headers[2]?.forEach(tspref => {
					var oldref = parse_TSP_Reference(tspref.data);
					var newref = get_unique_msgid({ deps: [tmaref], location: deps[oldref].location, type: deps[oldref].type }, deps);
					numbers_del_oref(tmaroot, oldref);
					numbers_add_oref(tmaroot, newref);
					remap[oldref] = newref;
					var msg = numbers_iwa_find(cfb, deps, oldref);
					msg.id = newref;
					if(deps[oldref].location == deps[tmaref].location) {
						arch.push(msg);
					} else {
						deps[newref].location = deps[oldref].location.replace(oldref.toString(), newref.toString());
						if(deps[newref].location == deps[oldref].location) deps[newref].location = deps[newref].location.replace(/\.iwa/, `-${newref}.iwa`);
						CFB.utils.cfb_add(cfb, deps[newref].location, compress_iwa_file(write_iwa_file([ msg ])));

						var newloc = deps[newref].location.replace(/^Root Entry\//,"").replace(/^Index\//, "").replace(/\.iwa$/,"");

						numbers_iwa_doit(cfb, deps, 2, (ai => {
							var mlist = parse_shallow(ai.messages[0].data);
							numbers_add_meta(mlist, newref, newloc);

							/* add reference from TableModelArchive file to Tile */
							numbers_meta_add_dep(mlist, deps, tmaref, newref);

							ai.messages[0].data = write_shallow(mlist);
						}));
					}
					tspref.data = write_TSP_Reference(newref);
				})
			}
			store[1][0].data = write_shallow(row_headers);

			/* copy tiles */
			var tiles = parse_shallow(store[3][0].data);
			{
				tiles[1].forEach(t => {
					var tst = parse_shallow(t.data);
					var oldtileref = parse_TSP_Reference(tst[2][0].data);
					var newtileref = remap[oldtileref];
					if(!remap[oldtileref]) {
						newtileref = get_unique_msgid({ deps: [tmaref], location: "", type: deps[oldtileref].type }, deps);
						deps[newtileref].location = `Root Entry/Index/Tables/Tile-${newtileref}.iwa`;
						remap[oldtileref] = newtileref;

						var oldtile = numbers_iwa_find(cfb, deps, oldtileref);
						oldtile.id = newtileref;
						numbers_del_oref(tmaroot, oldtileref);
						numbers_add_oref(tmaroot, newtileref);

						CFB.utils.cfb_add(cfb, `/Index/Tables/Tile-${newtileref}.iwa`, compress_iwa_file(write_iwa_file([ oldtile ])));

						numbers_iwa_doit(cfb, deps, 2, (ai => {
							var mlist = parse_shallow(ai.messages[0].data);
							mlist[3].push({type: 2, data: write_shallow([ [],
								[{type: 0, data: write_varint49(newtileref)}],
								[{type: 2, data: stru8("Tables/Tile") }],
								[{type: 2, data: stru8(`Tables/Tile-${newtileref}`)}],
								[{type: 2, data: new Uint8Array([2, 0, 0])}],
								[{type: 2, data: new Uint8Array([2, 0, 0])}],
								[], [], [], [], // skip fields 6-9
								[{type: 0, data: write_varint49(0)}],
								[],
								[{type: 0, data: write_varint49(0 /* TODO: save_token */)}],
							])});
							mlist[1] = [{type: 0, data: write_varint49(Math.max(newtileref + 1, varint_to_i32(mlist[1][0].data) ))}];

							/* add reference from TableModelArchive file to Tile */
							numbers_meta_add_dep(mlist, deps, tmaref, newtileref);

							ai.messages[0].data = write_shallow(mlist);
						}));
					}
					tst[2][0].data = write_TSP_Reference(newtileref);
					t.data = write_shallow(tst);
				})
			}
			store[3][0].data = write_shallow(tiles);
		}
		tma[4][0].data = write_shallow(store);
		tmaroot.messages[0].data = write_shallow(tma);
	});
}

/** Write NUMBERS worksheet */
function write_numbers_ws(cfb: CFB$Container, deps: Dependents, ws: WorkSheet, wsname: string, sheetidx: number, rootref: number): void {
	/* TODO: support more data types, etc */

	/* .TN.SheetArchive */
	var drawables: number[] = [];
	numbers_iwa_doit(cfb, deps, rootref, (docroot) => {

		var sheetref = parse_shallow(docroot.messages[0].data);
		{
			/* write worksheet name */
			sheetref[1] = [ { type: 2, data: stru8(wsname) }];
			drawables = mappa(sheetref[2], parse_TSP_Reference);
		}
		docroot.messages[0].data = write_shallow(sheetref);
	});

	/* .TST.TableInfoArchive */
	// TODO: verify that the first entry is actually a table
	// TODO: eventually support multiple tables (and replicate in QPW)
	var tia: IWAArchiveInfo = numbers_iwa_find(cfb, deps, drawables[0]);
	/* .TST.TableModelArchive */
	var tmaref = parse_TSP_Reference(parse_shallow(tia.messages[0].data)[2][0].data);
	numbers_iwa_doit(cfb, deps, tmaref, (docroot, x) => write_numbers_tma(cfb, deps, ws, docroot, x, tmaref));
}

var USE_WIDE_ROWS = true;

/** Write .TST.TableModelArchive */
function write_numbers_tma(cfb: CFB$Container, deps: Dependents, ws: WorkSheet, tmaroot: IWAArchiveInfo, tmafile: IWAArchiveInfo[], tmaref: number) {
	var range = decode_range(ws["!ref"] as string);
	range.s.r = range.s.c = 0;

	var trunc = false;
	/* Actual NUMBERS 12.1 range limit ALL1000000 */
	if(range.e.c > 999) { trunc = true; range.e.c = 999; }
	if(range.e.r > 999999) { trunc = true; range.e.r = 999999; }
	if(trunc) console.error(`Truncating to ${encode_range(range)}`);

	/* preprocess data and build up shared string table */
	var data: CellObject[][] = [];
	if(ws["!data"]) data = ws["!data"];
	else {
		var colstr: string[] = [];
		for(var _C = 0; _C <= range.e.c; ++_C) colstr[_C] = encode_col(_C);
		for(var R_ = 0; R_ <= range.e.r; ++R_) {
			data[R_] = [];
			var _R = "" + (R_+1);
			for(_C = 0; _C <= range.e.c; ++_C) {
				var _cell = ws[colstr[_C] + _R];
				if(!_cell) continue;
				data[R_][_C] = _cell;
			}
		}
	}
	var LUT: DataLUT = {
		 cmnt: [{a: "~54ee77S~", t: "... the people who are crazy enough to think they can change the world, are the ones who do."}],
		 ferr: [],
		 fmla: [],
		 nfmt: [],
		 ofmt: [],
		 rsst: [{v:"~54ee77S~", l: "https://sheetjs.com/"}],
		 sst:  ["~Sh33tJ5~"]
	};


	var pb = parse_shallow(tmaroot.messages[0].data);
	{
		pb[6][0].data = write_varint49(range.e.r + 1); // number_of_rows
		pb[7][0].data = write_varint49(range.e.c + 1); // number_of_columns
		// pb[22] = [ { type: 0, data: write_varint49(1) } ]; // displays table name in sheet

		delete pb[46]; // base_column_row_uids -- deleting forces Numbers to refresh cell table

		/* .TST.DataStore */
		var store = parse_shallow(pb[4][0].data);
		{
			/* rewrite row headers */
			var row_header_ref = parse_TSP_Reference(parse_shallow(store[1][0].data)[2][0].data);
			numbers_iwa_doit(cfb, deps, row_header_ref, (rowhead, _x) => {
				var base_bucket = parse_shallow(rowhead.messages[0].data);
				if(base_bucket?.[2]?.[0]) for(var R = 0; R < data.length; ++R) {
					var _bucket = parse_shallow(base_bucket[2][0].data);
					_bucket[1][0].data = write_varint49(R);
					_bucket[4][0].data = write_varint49(data[R].length);
					base_bucket[2][R] = { type: base_bucket[2][0].type, data: write_shallow(_bucket) };
				}
				rowhead.messages[0].data = write_shallow(base_bucket);
			});

			/* rewrite col headers */
			var col_header_ref = parse_TSP_Reference(store[2][0].data);
			numbers_iwa_doit(cfb, deps, col_header_ref, (colhead, _x) => {
				var base_bucket = parse_shallow(colhead.messages[0].data);
				for(var C = 0; C <= range.e.c; ++C) {
					var _bucket = parse_shallow(base_bucket[2][0].data);
					_bucket[1][0].data = write_varint49(C);
					_bucket[4][0].data = write_varint49(range.e.r + 1);
					base_bucket[2][C] = { type: base_bucket[2][0].type, data: write_shallow(_bucket) };
				}
				colhead.messages[0].data = write_shallow(base_bucket);
			});

			var rbtree = parse_shallow(store[9][0].data);
			rbtree[1] = [];

			/* .TST.TileStorage */
			var tilestore = parse_shallow(store[3][0].data);
			{
				/* number of rows per tile */
				var tstride = 256; // NOTE: if this is not 256, Numbers will assert and recalculate
				tilestore[2] = [{type: 0, data: write_varint49(tstride)}];
				//tilestore[3] = [{type: 0, data: write_varint49(USE_WIDE_ROWS ? 1 : 0)}]; // elicits a modification message

				var tileref = parse_TSP_Reference(parse_shallow(tilestore[1][0].data)[2][0].data);

				/* save the save_token from package metadata */
				var save_token = ((): number => {
					/* .TSP.PackageMetadata */
					var metadata = numbers_iwa_find(cfb, deps, 2);
					var mlist = parse_shallow(metadata.messages[0].data);
					/* .TSP.ComponentInfo field 1 is the id, field 12 is the save token */
					var mlst = mlist[3].filter(m => varint_to_i32(parse_shallow(m.data)[1][0].data) == tileref);
					return (mlst?.length) ? varint_to_i32(parse_shallow(mlst[0].data)[12][0].data) : 0;
				})();

				/* remove existing tile */
				{
					CFB.utils.cfb_del(cfb, deps[tileref].location);

					/* remove existing tile from reference */
					numbers_iwa_doit(cfb, deps, 2, (ai => {
						var mlist = parse_shallow(ai.messages[0].data);

						/* remove metadata entry for tile */
						mlist[3] = mlist[3].filter(m => varint_to_i32(parse_shallow(m.data)[1][0].data) != tileref);

						/* remove reference from TableModelArchive file to Tile */
						numbers_meta_del_dep(mlist, deps, tmaref, tileref);

						ai.messages[0].data = write_shallow(mlist);
					}));

					numbers_del_oref(tmaroot, tileref);
				}

				/* rewrite entire tile storage */
				tilestore[1] = [] as ProtoField;
				var ntiles = Math.ceil((range.e.r + 1)/tstride);

				for(var tidx = 0; tidx < ntiles; ++tidx) {
					var newtileid = get_unique_msgid({
						deps: [], // TODO: probably should update this
						location: "",
						type: 6002
					}, deps);
					deps[newtileid].location = `Root Entry/Index/Tables/Tile-${newtileid}.iwa`;

					/* create new tile */
					var tiledata: ProtoMessage = [ [],
						[{type: 0, data: write_varint49(0 /*range.e.c + 1*/)}],
						[{type: 0, data: write_varint49(Math.min(range.e.r + 1, (tidx + 1) * tstride))}],
						[{type: 0, data: write_varint49(0/*cnt*/)}],
						[{type: 0, data: write_varint49(Math.min((tidx+1)*tstride,range.e.r+1) - tidx * tstride)}],
						[],
						[{type: 0, data: write_varint49(5)}],
						[{type: 0, data: write_varint49(1)}],
						[{type: 0, data: write_varint49(USE_WIDE_ROWS ? 1 : 0)}]
					];
					for(var R = tidx * tstride; R <= Math.min(range.e.r, (tidx + 1) * tstride - 1); ++R) {
						var tilerow = write_TST_TileRowInfo(data[R], LUT, USE_WIDE_ROWS);
						tilerow[1][0].data = write_varint49(R - tidx * tstride);
						tiledata[5].push({data: write_shallow(tilerow), type: 2});
					}

					/* add to tiles */
					tilestore[1].push({type: 2, data: write_shallow([ [],
						[{type: 0, data: write_varint49(tidx)}],
						[{type: 2, data: write_TSP_Reference(newtileid)}]
					])});

					/* add to file */
					var newtile: IWAArchiveInfo = {
						id: newtileid,
						messages: [ write_iwam(6002, write_shallow(tiledata))]
					};
					var tilecontent = compress_iwa_file(write_iwa_file([newtile]));
					CFB.utils.cfb_add(cfb, `/Index/Tables/Tile-${newtileid}.iwa`, tilecontent);

					/* update metadata */
					numbers_iwa_doit(cfb, deps, 2, (ai => {
						var mlist = parse_shallow(ai.messages[0].data);
						mlist[3].push({type: 2, data: write_shallow([ [],
							[{type: 0, data: write_varint49(newtileid)}],
							[{type: 2, data: stru8("Tables/Tile") }],
							[{type: 2, data: stru8(`Tables/Tile-${newtileid}`)}],
							[{type: 2, data: new Uint8Array([2, 0, 0])}],
							[{type: 2, data: new Uint8Array([2, 0, 0])}],
							[], [], [], [], // skip fields 6-9
							[{type: 0, data: write_varint49(0)}],
							[], // skip field 11
							[{type: 0, data: write_varint49(save_token)}],
						])});
						mlist[1] = [{type: 0, data: write_varint49(Math.max(newtileid + 1, varint_to_i32(mlist[1][0].data) ))}];

						/* add reference from TableModelArchive file to Tile */
						numbers_meta_add_dep(mlist, deps, tmaref, newtileid);

						ai.messages[0].data = write_shallow(mlist);
					}));

					/* add to TableModelArchive object references */
					numbers_add_oref(tmaroot, newtileid);

					/* add to row rbtree */
					rbtree[1].push({type: 2, data: write_shallow([ [],
						[{ type: 0, data: write_varint49(tidx*tstride) }],
						[{ type: 0, data: write_varint49(tidx) }]
					])});
				}
			}
			store[3][0].data = write_shallow(tilestore);
			store[9][0].data = write_shallow(rbtree);
			store[10] = [ { type: 2, data: new Uint8Array([]) }];

			/* write merge list */
			if(ws["!merges"]) {
				var mergeid = get_unique_msgid({
					type: 6144,
					deps: [tmaref],
					location: deps[tmaref].location
				}, deps);

				tmafile.push({
					id: mergeid,
					messages: [ write_iwam(6144, write_shallow([ [],
						ws["!merges"].map((m: Range) => ({type: 2, data: write_shallow([ [],
							[{ type: 2, data: write_shallow([ [],
								[{ type: 5, data: new Uint8Array(new Uint16Array([m.s.r, m.s.c]).buffer) }],
							])}],
							[{ type: 2, data: write_shallow([ [],
								[{ type: 5, data: new Uint8Array(new Uint16Array([m.e.r - m.s.r + 1, m.e.c - m.s.c + 1]).buffer) }],
							]) }]
						])} as ProtoItem))
					])) ]
				} as IWAArchiveInfo);
				store[13] = [ { type: 2, data: write_TSP_Reference(mergeid) } ];

				numbers_iwa_doit(cfb, deps, 2, (ai => {
					var mlist = parse_shallow(ai.messages[0].data);

					/* add reference from TableModelArchive file to merge */
					numbers_meta_add_dep(mlist, deps, tmaref, mergeid);

					ai.messages[0].data = write_shallow(mlist);
				}));

				/* add object reference from TableModelArchive */
				numbers_add_oref(tmaroot, mergeid);

			} else delete store[13]; // TODO: delete references to merge if not needed

			/* rebuild shared string table */
			var sstref = parse_TSP_Reference(store[4][0].data);
			numbers_iwa_doit(cfb, deps, sstref, (sstroot) => {
				var sstdata = parse_shallow(sstroot.messages[0].data);
				{
					sstdata[3] = [];
					LUT.sst.forEach((str, i) => {
						if(i == 0) return; // Numbers will assert if index zero
						sstdata[3].push({type: 2, data: write_shallow([ [],
							[ { type: 0, data: write_varint49(i) } ],
							[ { type: 0, data: write_varint49(1) } ],
							[ { type: 2, data: stru8(str) } ]
						])});
					});
				}
				sstroot.messages[0].data = write_shallow(sstdata);
			});

			/* rebuild rich shared string table */
			var rsstref = parse_TSP_Reference(store[17][0].data);
			numbers_iwa_doit(cfb, deps, rsstref, (rsstroot) => {
				var rsstdata = parse_shallow(rsstroot.messages[0].data);
				/* TODO: remove unused children */
				rsstdata[3] = [];

				/* TODO: this must be in sync with zahl */
				var style_indices = [
					904980, // hardcoded stylesheet
					903835, // paragraph style
					903815, // list style
					903845  // character style
				];

				LUT.rsst.forEach((rsst, i) => {
					if(i == 0) return;

					/* create .TSWP.StorageArchive (2001) */
					var tswpsa: ProtoMessage = [ [],
						[ { type: 0, data: new Uint8Array([5]) }], // .TSWP.StorageArchive.KindType CELL = 5
						[],
						[ { type: 2, data: stru8(rsst.v) }]
					];
					tswpsa[10] = [ { type: 0, data: new Uint8Array([1]) } ];
					tswpsa[19] = [ { type: 2, data: new Uint8Array([10, 6, 8, 0, 18, 2, 101, 110])}]; // "en"

					// Even though field 5 `table_para_style` is "optional", Numbers 13 crashes without a clear error message if this is not included
					tswpsa[5]  = [ { type: 2, data: new Uint8Array([0x0a, 0x08, 0x08, 0x00, 0x12, 0x04, 0x08, 0x9b, 0x95, 0x37])}];

					// At least Numbers tells you the file is corrupt if some of these fields are missing
					tswpsa[2]  = [ { type: 2, data: new Uint8Array([8, 148, 158, 55])}]; // msg 904980 TODO: verify in the zahl build script
					tswpsa[6]  = [ { type: 2, data: new Uint8Array([0x0a, 0x06, 0x08, 0x00, 0x10, 0x00, 0x18, 0x00])}];
					tswpsa[7]  = [ { type: 2, data: new Uint8Array([0x0a, 0x08, 0x08, 0x00, 0x12, 0x04, 0x08, 0x87, 0x95, 0x37])}];
					tswpsa[8]  = [ { type: 2, data: new Uint8Array([10, 8, 8, 0, 18, 4, 8, 165, 149, 55])}]; // TODO: revisit with mixed links
					tswpsa[14] = [ { type: 2, data: new Uint8Array([0x0a, 0x06, 0x08, 0x00, 0x10, 0x00, 0x18, 0x00])}];
					tswpsa[24] = [ { type: 2, data: new Uint8Array([0x0a, 0x06, 0x08, 0x00, 0x10, 0x00, 0x18, 0x00])}];

					var tswpsaid = get_unique_msgid({ deps: [], location: "", type: 2001 }, deps);
					var tswpsarefs: number[] = [];

					/* add hyperlink if specified */
					if(rsst.l) {
						/* create .TSWP.HyperlinkFieldArchive (2032) */
						var newhlinkid = numbers_add_msg(cfb, 2032, [ [],
							[],
							[ { type: 2, data: stru8(rsst.l) } ]
						], "/Index/Tables/DataList", deps);
						/* add to smart field table */
						tswpsa[11] = [];
						var smartfield: ProtoMessage = [[], []];
						if(!smartfield[1]) smartfield[1] = [];

						/* TODO: note that this applies one link to the entire text */
						smartfield[1].push({ type: 2, data: write_shallow([ [],
							[ { type: 0, data: write_varint49(0) }],
							[ { type: 2, data: write_TSP_Reference(newhlinkid) }]
						]) });
						tswpsa[11][0] = { type: 2, data: write_shallow(smartfield) };
						tswpsarefs.push(newhlinkid);
					}

					/* add .TSWP.StorageArchive and object references */
					numbers_add_msg(cfb, 2001, tswpsa, "/Index/Tables/DataList", deps, tswpsaid);
					numbers_iwa_doit(cfb, deps, tswpsaid, iwa => {
						style_indices.forEach(ref => numbers_add_oref(iwa, ref));
						tswpsarefs.forEach(ref => numbers_add_oref(iwa, ref));
					});

					/* create .TST.RichTextPayloadArchive (6218) */
					var rtpaid = numbers_add_msg(cfb, 6218, [ [],
						[ { type: 2, data: write_TSP_Reference(tswpsaid) }],
						[],
						[{ type: 2, data: new Uint8Array([ 13, 255, 255, 255, 0, 18, 10, 16, 255, 255, 1, 24, 255, 255, 255, 255, 7 ]) }],
					], "/Index/Tables/DataList", deps);
					numbers_iwa_doit(cfb, deps, rtpaid, iwa => numbers_add_oref(iwa, tswpsaid));

					/* add to rsst */
					rsstdata[3].push({type: 2, data: write_shallow([ [],
						[ { type: 0, data: write_varint49(i) } ],
						[ { type: 0, data: write_varint49(1) } ],
						[], [], [], [], [], [], // skip fields 3-8
						[ { type: 2, data: write_TSP_Reference(rtpaid) } ]
					])});
					numbers_add_oref(rsstroot, rtpaid);

					/* try to wire up other missing deps */
					numbers_iwa_doit(cfb, deps, 2, ai => {
						var mlist = parse_shallow(ai.messages[0].data);

						/* rsst -> rich text payload */
						numbers_meta_add_dep(mlist, deps, rsstref, rtpaid);

						/* rich text payload -> storage archive */
						numbers_meta_add_dep(mlist, deps, rtpaid, tswpsaid);

						/* storage archive -> smart fields */
						numbers_meta_add_dep(mlist, deps, tswpsaid, tswpsarefs);
						numbers_meta_add_dep(mlist, deps, tswpsaid, style_indices);

						ai.messages[0].data = write_shallow(mlist);
					});
				});
				rsstroot.messages[0].data = write_shallow(rsstdata);
			});

			/* rebuild comment table */
			if(LUT.cmnt.length > 1) {
				/* TODO: verify zahl has a comment storage */
				var cmntref = parse_TSP_Reference(store[19][0].data);
				var authors: {[a: string]: number} = {}, iauthor = 0; /* TODO: this should be a Map */
				numbers_iwa_doit(cfb, deps, cmntref, (cmntroot) => {
					var cmntdata = parse_shallow(cmntroot.messages[0].data);
					{
						cmntdata[3] = [];
						LUT.cmnt.forEach((cc,i) => {
							if(i == 0) return;
							var replies: number[] = [];
							/* TODO: this assumes one level of replies */
							if(cc.replies) cc.replies.forEach(c => {
								/* .TSK.AnnotationAuthorArchive (212) TODO: unify names across book */
								if(!authors[c.a||""]) authors[c.a||""] = numbers_add_msg(cfb, 212, [ [],
									[ { type: 2, data: stru8(c.a||"") }],
									[ { type: 2, data: get_author_color(++iauthor) }],
									[],
									[ { type: 0, data: write_varint49(0) } ]
								], "/Index/Tables/DataList", deps);
								var aaaid = authors[c.a||""];

								/* .TSD.CommentStorageArchive (3056) */
								var csaid = numbers_add_msg(cfb, 3056, [ [],
									[ { type: 2, data: stru8(c.t||"") }],
									[ { type: 2, data: write_shallow([[],
										[ { type: 1, data: new Uint8Array([0, 0, 0, 128, 116, 109, 182, 65]) }]
									]) }],
									[ { type: 2, data: write_TSP_Reference(aaaid) }]
								], "/Index/Tables/DataList", deps);
								numbers_iwa_doit(cfb, deps, csaid, iwa => numbers_add_oref(iwa, aaaid));
								replies.push(csaid);

								/* meta deps */
								numbers_iwa_doit(cfb, deps, 2, ai => {
									var mlist = parse_shallow(ai.messages[0].data);

									/* CSA -> AAA */
									numbers_meta_add_dep(mlist, deps, csaid, aaaid);

									ai.messages[0].data = write_shallow(mlist);
								});
							});

							/* .TSK.AnnotationAuthorArchive (212) TODO: unify names across book */
							if(!authors[cc.a||""]) authors[cc.a||""] = numbers_add_msg(cfb, 212, [ [],
								[ { type: 2, data: stru8(cc.a||"") }],
								[ { type: 2, data: get_author_color(++iauthor) }],
								[],
								[ { type: 0, data: write_varint49(0) } ]
							], "/Index/Tables/DataList", deps);
							var aaaid = authors[cc.a||""];

							/* .TSD.CommentStorageArchive (3056) */
							var csaid = numbers_add_msg(cfb, 3056, [ [],
								[ { type: 2, data: stru8(cc.t||"") }],
								[ { type: 2, data: write_shallow([[],
									[ { type: 1, data: new Uint8Array([0, 0, 0, 128, 116, 109, 182, 65]) }]
								]) }],
								[ { type: 2, data: write_TSP_Reference(aaaid) }],
								replies.map(r => ({type: 2, data: write_TSP_Reference(r)})),
								[ { type: 2, data: write_shallow([[],
									[ { type: 0, data: write_varint49(i) }],
									[ { type: 0, data: write_varint49(0) }]
								]) }],
							], "/Index/Tables/DataList", deps);
							numbers_iwa_doit(cfb, deps, csaid, iwa => {
								numbers_add_oref(iwa, aaaid);
								replies.forEach(r => numbers_add_oref(iwa, r));
							});

							/* add to TableDataList */
							cmntdata[3].push({type: 2, data: write_shallow([ [],
								[ { type: 0, data: write_varint49(i) } ],
								[ { type: 0, data: write_varint49(1) } ],
								[], [], [], [], [], [], [], // skip fields 3-9
								[ { type: 2, data: write_TSP_Reference(csaid) } ]
							])});
							numbers_add_oref(cmntroot, csaid);

							/* meta deps */
							numbers_iwa_doit(cfb, deps, 2, ai => {
								var mlist = parse_shallow(ai.messages[0].data);
								numbers_meta_add_dep(mlist, deps, cmntref, csaid); //  table -> CSA
								numbers_meta_add_dep(mlist, deps, csaid, aaaid); // CSA -> author
								if(replies.length) numbers_meta_add_dep(mlist, deps, csaid, replies); // CSA -> replies
								ai.messages[0].data = write_shallow(mlist);
							});

						});
					}
					cmntdata[2][0].data = write_varint49(LUT.cmnt.length + 1);
					cmntroot.messages[0].data = write_shallow(cmntdata);
				});
			}
		}
		pb[4][0].data = write_shallow(store);
	}
	tmaroot.messages[0].data = write_shallow(pb);
}
