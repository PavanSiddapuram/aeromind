FROM node:22-alpine

WORKDIR /app

# Copy workspace manifests first to make dependency installation cacheable.
COPY package.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json

RUN npm install

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "run", "start", "--workspace", "@aeromind/server"]
