# Build multi-estágio: o estágio "build" tem as devDependencies (Vite,
# esbuild, TypeScript) só pra compilar; a imagem final só leva o resultado
# (dist/) + as dependências de produção, bem menor que rodar `npm run build`
# dentro do próprio contêiner de produção.
#
# node:24-bookworm-slim (não alpine) de propósito: ffmpeg-static
# (server/services/audioTranscode.ts) baixa um binário estático pré-compilado
# no postinstall — glibc é a escolha mais segura pra esse tipo de binário,
# musl (alpine) ocasionalmente dá problema de compatibilidade. Versão 24
# pra bater com o Node real de produção hoje no Render (confirmado via log,
# TASK-0317) — sem "engines" declarado no package.json pra travar isso.
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Estágio final: só o necessário em produção ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# server.ts (via esbuild --packages=external) espera process.cwd()/dist —
# ver server.ts, distPath = path.join(process.cwd(), 'dist'). O bundle do
# servidor (dist/server.cjs) e os assets do frontend (Vite) saem juntos no
# mesmo diretório.
COPY --from=build /app/dist ./dist

EXPOSE 10000
CMD ["node", "dist/server.cjs"]
