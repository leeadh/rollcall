FROM alpine:latest

# Declare who maintains this Dockerfile
LABEL maintainer="TBWFDU"

# Create volume for accessproxy 
RUN mkdir -p /rollcall/accessproxy/config
# VOLUME /rollcall/accessproxy/config
# Create volume for accessproxy 
RUN mkdir -p /rollcall/admin-ui/config && \
    mkdir /run/nginx
# VOLUME /rollcall/admin-ui/config
# Add container dependencies for build and run
RUN apk add --update && \
    apk add nodejs && \
    apk add npm && \
    apk add nginx && \
    npm update && \
    npm install -g python

# Basedir of Rollcall

WORKDIR /rollcall

# Add the application dependency files
ADD ./accessproxy/package.json /rollcall/accessproxy
ADD ./admin-ui/package.json /rollcall/admin-ui
# Copy everything from the cloned repo
COPY . .

# Run installs for Node.js, NPM and Angular
RUN cd /rollcall/accessproxy && \
    npm install --production --unsafe-perm && \
    cp /rollcall/template.env /rollcall/accessproxy/config/.env
RUN cd /rollcall/admin-ui && \
    npm install -g @angular/cli && \
    npm update && \
    ng update
RUN cd /rollcall/admin-ui && \
    npm install --unsafe-perm && \
    ng build --prod
# Copy the NGINX config.
RUN mv /rollcall/rollcall.conf /etc/nginx/conf.d/default.conf && \
    rm /rollcall/admin-ui/env.json
# Expose port 80 and 443 in case we want to use SSL later
EXPOSE 80
EXPOSE 443

# No bash in Alpine - go.sh runs nginx silently and outputs to /dev/null and allow accessproxy to write to console.
CMD ["sh", "go.sh"]