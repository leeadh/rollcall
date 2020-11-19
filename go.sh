nginx -g "daemon off;" > /dev/null 2>&1 &
echo nginx running in backround
echo starting accessproxy
node /rollcall/accessproxy/index.js