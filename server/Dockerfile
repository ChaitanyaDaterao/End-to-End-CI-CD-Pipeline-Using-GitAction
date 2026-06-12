
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN rm -f debug*.js fix-*.js cleanup*.js check-*.js \
    audit-*.js backup-*.js diagnose-*.js find-*.js \
    inspect-*.js migrate-*.js peek-*.js pl-*.js \
    preview-*.js force_*.js count-*.js week-*.js

USER nodeuser

EXPOSE 5000

CMD ["node", "index.js"]
