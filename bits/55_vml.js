/* L.5.5.2 SpreadsheetML Comments + VML Schema */
var shapevmlregex = /<(?:\w+:)?shape(?:[^\w][^>]*)?>([\s\S]*?)<\/(?:\w+:)?shape>/g;
function parse_vml(data/*:string*/, sheet, comments) {
	var cidx = 0;
	(data.match(shapevmlregex)||[]).forEach(function(m) {
		var type = "";
		var hidden = true;
		var aidx = -1;
		var R = -1, C = -1;
		m.replace(tagregex, function(x/*:string*/, idx/*:number*/) {
			var y = parsexmltag(x);
			switch(strip_ns(y[0])) {
				case '<ClientData': if(y.ObjectType) type = y.ObjectType; break;

				case '<Visible': case '<Visible/>': hidden = false; break;

				case '<Row': case '<Row>': aidx = idx + x.length; break;
				case '</Row>': R = +m.slice(aidx, idx).trim(); break;

				case '<Column': case '<Column>': aidx = idx + x.length; break;
				case '</Column>': C = +m.slice(aidx, idx).trim(); break;
			}
			return "";
		});
		switch(type) {
		case 'Note':
			var cell = ws_get_cell_stub(sheet, ((R>=0 && C>=0) ? encode_cell({r:R,c:C}) : comments[cidx].ref));
			if(cell.c) {
				cell.c.hidden = hidden;
			}
			++cidx;
			break;
		}

	});
}


/* comment boxes */
function write_vml(rId/*:number*/, comments, ws) {
	var csize = [21600, 21600];
	/* L.5.2.1.2 Path Attribute */
	var bbox = ["m0,0l0",csize[1],csize[0],csize[1],csize[0],"0xe"].join(",");
	var o = [
		writextag("xml", null, { 'xmlns:v': XLMLNS.v, 'xmlns:o': XLMLNS.o, 'xmlns:x': XLMLNS.x, 'xmlns:mv': XLMLNS.mv }).replace(/\/>/,">"),
		writextag("o:shapelayout", writextag("o:idmap", null, {'v:ext':"edit", 'data':rId}), {'v:ext':"edit"})
	];

	var _shapeid = 65536 * rId;

	var _comments = comments || [];
	if(_comments.length > 0) o.push(writextag("v:shapetype", [
		writextag("v:stroke", null, {joinstyle:"miter"}),
		writextag("v:path", null, {gradientshapeok:"t", 'o:connecttype':"rect"})
	].join(""), {id:"_x0000_t202", coordsize:csize.join(","), 'o:spt':202, path:bbox}));

	_comments.forEach(function(x) { ++_shapeid; o.push(write_vml_comment(x, _shapeid)); });
	o.push('</xml>');
	return o.join("");
}

function write_vml_comment(x, _shapeid, ws)/*:string*/ {
	var c = decode_cell(x[0]);
	var fillopts = /*::(*/{'color2':"#BEFF82", 'type':"gradient"}/*:: :any)*/;
	if(fillopts.type == "gradient") fillopts.angle = "-180";
	var fillparm = fillopts.type == "gradient" ? writextag("o:fill", null, {type:"gradientUnscaled", 'v:ext':"view"}) : null;
	var fillxml = writextag('v:fill', fillparm, fillopts);

	var shadata = ({on:"t", 'obscured':"t"}/*:any*/);

	return [
	'<v:shape' + wxt_helper({
		id:'_x0000_s' + _shapeid,
		type:"#_x0000_t202",
		style:"position:absolute; margin-left:80pt;margin-top:5pt;width:104pt;height:64pt;z-index:10" + (x[1].hidden ? ";visibility:hidden" : "") ,
		fillcolor:"#ECFAD4",
		strokecolor:"#edeaa1"
	}) + '>',
		fillxml,
		writextag("v:shadow", null, shadata),
		writextag("v:path", null, {'o:connecttype':"none"}),
		'<v:textbox><div style="text-align:left"></div></v:textbox>',
		'<x:ClientData ObjectType="Note">',
			'<x:MoveWithCells/>',
			'<x:SizeWithCells/>',
			/* Part 4 19.4.2.3 Anchor (Anchor) */
			writetag('x:Anchor', [c.c+1, 0, c.r+1, 0, c.c+3, 20, c.r+5, 20].join(",")),
			writetag('x:AutoFill', "False"),
			writetag('x:Row', String(c.r)),
			writetag('x:Column', String(c.c)),
			x[1].hidden ? '' : '<x:Visible/>',
		'</x:ClientData>',
	'</v:shape>'
	].join("");
}
