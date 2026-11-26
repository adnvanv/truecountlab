# TrueCountLab in a container: the same zero-dependency Node server, with the SQLite
# database on a volume.
#   docker build -t truecountlab .
#   docker run -p 3040:3040 -v truecountlab-data:/data truecountlab
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3040 \
    DATA_DIR=/data

WORKDIR /app
COPY server.js ./
COPY server ./server
COPY public ./public

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3040

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3040/healthz | grep -q '"status":"ok"' || exit 1

# SIGTERM (docker stop) shuts down cleanly: players are told, connections closed, counters saved.
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
