FROM node:22-alpine

WORKDIR /app

COPY apps/demo-web/package*.json ./
RUN npm ci

COPY apps/demo-web ./

ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

EXPOSE 4173

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
