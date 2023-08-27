#!/bin/bash
# test.sh -- testing script
# Copyright (C) 2013-present  SheetJS
# usage:
#   test.sh prep # installs requisite modules
#   test.sh clean # removes test logs
#   test.sh all # runs all tests
# logs are dumped in *.tests
timeout() { perl -e 'alarm shift; exec @ARGV' "$@"; }

TIMEOUT=${TEST_TIMEOUT:-60}

do_test() {
	echo "# $1" >>"$2".tests
	timeout $TIMEOUT $3 "$1" >/dev/null 2>>"$2".tests
	echo "- $? $1" >>"$2".tests
}

case "$1" in
"prep")
	npm install -g j
	#pip install -r requirements.txt --use-mirrors
	#gem install roo spreadsheet
	;;
"clean")
	rm -f *.tests
	;;
"all")
	for i in *.xls *.xlsb *.xlsm *.xlsx *.xml; do
		if [[ $(grep -qx "$i" tests.skip) -gt 0 ]]; then continue; fi
		echo $i >&2
		do_test "$i" core "j"
		#do_test "$i" xlrd "python tests/xlrd.py"
		#do_test "$i" roo "ruby tests/roo.rb"
	done
	grep -- "^- [^0]" *.tests
	# suppress grep's return value
	echo
	;;
"help"|"--help"|"-h")
	echo "usage: test.sh <action>"
	echo "    prep     # installs required modules"
	echo "    clean    # removes test logs"
	echo "    all      # runs all tests"
	echo ""
	echo "each test times out after \${TEST_TIMEOUT:-60} seconds"
	echo "For more information: https://github.com/SheetJS/test_files"
	;;
esac
