FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY backend/package.json ./backend/package.json
COPY dashboard/package.json ./dashboard/package.json
COPY widget/package.json ./widget/package.json

RUN npm install

FROM deps AS builder
WORKDIR /app
COPY . .

RUN npm run build --workspace widget
RUN npm run build --workspace backend
RUN npm run build --workspace dashboard

FROM node:20-alpine AS backend
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/widget/dist ./widget/dist
COPY package.json ./package.json

EXPOSE 4000
CMD ["npm", "run", "start", "--workspace", "backend"]

FROM node:20-alpine AS dashboard
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dashboard ./dashboard
COPY package.json ./package.json

EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "dashboard"]
