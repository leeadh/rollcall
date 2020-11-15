#!/bin/sh
node /rollcall/accessproxy/index.js > /dev/null 2>&1 &
nginx -g "daemon off;" > /dev/null 2>&1 &
