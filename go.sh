#!/bin/sh
nginx -g "daemon off;" > /dev/null 2>&1 &
node /rollcall/accessproxy/index.js