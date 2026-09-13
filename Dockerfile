# 看山 · 会饿的知乎代理 —— 容器镜像定义
#
# 为什么需要这个文件：
#   我们的作品是「Node 服务 + 静态文件」，必须跑在**常驻进程**里
#   （OAuth 的会话存在进程内存 Map 里，Serverless 的无状态实例会让登录状态丢失）。
#   所以部署形态是容器 / 云托管，而不是静态托管。
#
# 本项目零依赖（package.json 里没有 dependencies），所以没有 npm install 这一步。

FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY hackathon.config.json ./
COPY lib/ ./lib/
COPY public/ ./public/

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

EXPOSE 4173

# server.mjs 会优先读取平台注入的 PORT，并把 host 切到 0.0.0.0
CMD ["node", "server.mjs"]
