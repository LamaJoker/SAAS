# AutoDemo SaaS — image de production
# build : docker build -t autodemo .
# run   : docker run -d -p 3000:3000 --env-file .env -v autodemo-data:/app/data -v autodemo-output:/app/output autodemo
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Dépendances d'abord (cache Docker) — better-sqlite3 télécharge un binaire précompilé
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY templates ./templates
COPY frontend ./frontend

# Données persistantes (DB + sites générés) : à monter en volumes
RUN mkdir -p data output logs && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/main.js"]
