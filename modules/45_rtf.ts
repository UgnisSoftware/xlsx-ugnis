import { WorkBook, WorkSheet, Range, CellObject, DenseSheet, SparseSheet, ParsingOptions, WritingOptions } from '../';
import type { utils } from "../";
type RawData = any;

declare var encode_cell: typeof utils.encode_cell;
declare var encode_range: typeof utils.encode_range;
declare var format_cell: typeof utils.format_cell;
declare var safe_decode_range: typeof utils.decode_range;
declare function sheet_to_workbook(s: WorkSheet, o?: any): WorkBook;
declare function cc2str(d: any): string;
declare function a2s(a: any): string;
declare var has_buf: boolean;
declare function Base64_decode(s: string): string;
declare function fuzzynum(s: string): number;

function rtf_to_sheet(d: RawData, opts: ParsingOptions): WorkSheet {
	switch(opts.type) {
		case 'base64': return rtf_to_sheet_str(Base64_decode(d), opts);
		case 'binary': return rtf_to_sheet_str(d, opts);
		case 'buffer': return rtf_to_sheet_str(has_buf && Buffer.isBuffer(d) ? d.toString('binary') : a2s(d), opts);
		case 'array':  return rtf_to_sheet_str(cc2str(d), opts);
	}
	throw new Error("Unrecognized type " + opts.type);
}

/* TODO: this is a stub */
function rtf_to_sheet_str(str: string, opts: ParsingOptions): WorkSheet {
	var o = opts || {};
	// ESBuild issue 2375
	var ws: WorkSheet = {} as WorkSheet;
	var dense = o.dense;
	if(dense) ws["!data"] = [];

	var rows = str.match(/\\trowd[\s\S]*?\\row\b/g);
	if(!rows) throw new Error("RTF missing table");
	var range: Range = {s: {c:0, r:0}, e: {c:0, r:rows.length - 1}};
	var row: CellObject[] = [];
	rows.forEach(function(rowtf, R) {
		if(dense) row = (ws as DenseSheet)["!data"][R] = [] as CellObject[];
		var rtfre = /\\[\w\-]+\b/g;
		var last_index = 0;
		var res;
		var C = -1;
		var payload: string[] = [];
		while((res = rtfre.exec(rowtf)) != null) {
			var data = rowtf.slice(last_index, rtfre.lastIndex - res[0].length);
			if(data.charCodeAt(0) == 0x20) data = data.slice(1);
			if(data.length) payload.push(data);
			switch(res[0]) {
				case "\\cell":
					++C;
					if(payload.length) {
						// TODO: value parsing, including codepage adjustments
						var cell: CellObject = {v: payload.join(""), t:"s"};
						if(cell.v == "TRUE" || cell.v == "FALSE") { cell.v = cell.v == "TRUE"; cell.t = "b"; }
						else if(!isNaN(fuzzynum(cell.v as string))) { cell.t = 'n'; if(o.cellText !== false) cell.w = cell.v as string; cell.v = fuzzynum(cell.v as string); }

						if(dense) row[C] = cell;
						else (ws as SparseSheet)[encode_cell({r:R, c:C})] = cell;
					}
					payload = [];
					break;
				case "\\par": // NOTE: Excel serializes both "\r" and "\n" as "\\par"
					payload.push("\n");
					break;
			}
			last_index = rtfre.lastIndex;
		}
		if(C > range.e.c) range.e.c = C;
	});
	ws['!ref'] = encode_range(range);
	return ws;
}

function rtf_to_workbook(d: RawData, opts: ParsingOptions): WorkBook {
	var wb: WorkBook = sheet_to_workbook(rtf_to_sheet(d, opts), opts);
	wb.bookType = "rtf";
	return wb;
}

/* TODO: this is a stub */
function sheet_to_rtf(ws: WorkSheet, opts: WritingOptions): string {
	var o: string[] = ["{\\rtf1\\ansi"];
	if(!ws["!ref"]) return o[0] + "}";
	var r = safe_decode_range(ws['!ref']), cell: CellObject;
	var dense = ws["!data"] != null, row: CellObject[] = [];
	for(var R = r.s.r; R <= r.e.r; ++R) {
		o.push("\\trowd\\trautofit1");
		for(var C = r.s.c; C <= r.e.c; ++C) o.push("\\cellx" + (C+1));
		o.push("\\pard\\intbl");
		if(dense) row = (ws as DenseSheet)["!data"][R] || ([] as CellObject[])
		for(C = r.s.c; C <= r.e.c; ++C) {
			var coord = encode_cell({r:R,c:C});
			cell = dense ? row[C] : (ws as SparseSheet)[coord];
			if(!cell || cell.v == null && (!cell.f || cell.F)) { o.push(" \\cell"); continue; }
			o.push(" " + (cell.w || (format_cell(cell), cell.w) || "").replace(/[\r\n]/g, "\\par "));
			o.push("\\cell");
		}
		o.push("\\pard\\intbl\\row");
	}
	return o.join("") + "}";
}
