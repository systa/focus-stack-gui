FROM node:20-slim

WORKDIR /app

# install runtime dependencies if needed
COPY package.json ./
RUN npm install

#RUN npm ci --only=production || npm install --only=production

# copy server
COPY server.js ./

# If `focus stack` is local binary/script, copy it:
# COPY focus-stack /usr/local/bin/focus-stack
# RUN chmod +x /usr/local/bin/focus-stack

EXPOSE 3000
CMD ["node", "server.js"]
