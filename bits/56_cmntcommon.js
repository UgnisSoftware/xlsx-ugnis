function sheet_insert_comments(sheet/*:WorkSheet*/, comments/*:Array<RawComment>*/, threaded/*:boolean*/, people/*:?Array<any>*/) {
	var dense = sheet["!data"] != null;
	var cell/*:Cell*/;
	comments.forEach(function(comment) {
		var r = decode_cell(comment.ref);
		if(r.r < 0 || r.c < 0) return;
		if(dense) {
			if(!sheet["!data"][r.r]) sheet["!data"][r.r] = [];
			cell = sheet["!data"][r.r][r.c];
		} else cell = sheet[comment.ref];
		if (!cell) {
			cell = ({t:"z"}/*:any*/);
			if(dense) sheet["!data"][r.r][r.c] = cell;
			else sheet[comment.ref] = cell;
			var range = safe_decode_range(sheet["!ref"]||"BDWGO1000001:A1");
			if(range.s.r > r.r) range.s.r = r.r;
			if(range.e.r < r.r) range.e.r = r.r;
			if(range.s.c > r.c) range.s.c = r.c;
			if(range.e.c < r.c) range.e.c = r.c;
			var encoded = encode_range(range);
			sheet["!ref"] = encoded;
		}

		if (!cell.c) cell.c = [];
		var o/*:Comment*/ = ({a: comment.author, t: comment.t, r: comment.r, T: threaded});
		if(comment.h) o.h = comment.h;

		/* threaded comments always override */
		for(var i = cell.c.length - 1; i >= 0; --i) {
			if(!threaded && cell.c[i].T) return;
			if(threaded && !cell.c[i].T) cell.c.splice(i, 1);
		}
		if(threaded && people) for(i = 0; i < people.length; ++i) {
			if(o.a == people[i].id) { o.a = people[i].name || o.a; break; }
		}
		cell.c.push(o);
	});
}
