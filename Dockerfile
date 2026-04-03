FROM node:20-slim

WORKDIR /app

# install runtime dependencies if needed
RUN echo 'deb http://deb.debian.org/debian testing main' >> /etc/apt/sources.list.d/testing.list && \
    apt-get update && \
    apt-get install -y libopencv-dev libstdc++6/testing && \
    rm /etc/apt/sources.list.d/testing.list && \
    apt-get update && \
    rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install

#RUN npm ci --only=production || npm install --only=production

# copy server
COPY server.js ./
#COPY /usr/local/bin/focus-stack ./

# If `focus stack` is local binary/script, copy it:
COPY focus-stack /usr/local/bin/focus-stack
RUN chmod +x /usr/local/bin/focus-stack

EXPOSE 3000
CMD ["node", "server.js"]
