#!/bin/bash
dir_name=$(dirname "$0")
function kill_proc () {
	for p in $(ps ax | grep -v grep | grep wsserver | awk '{print $1}'); do
		echo "Killing $p"
		kill $1 $p
	done
}
kill_proc
kill_proc "-9"

exec "$dir_name/wsserver"
