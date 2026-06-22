FROM node:20-alpine

WORKDIR /app

# Install build tools for better-sqlite3 native module
RUN apk add --no-cache python3 make g++ sqlite-dev

# Copy demo package files and install dependencies
COPY demo/package.json demo/package-lock.json* ./
RUN npm install --omit=dev

# Copy the demo app source and the debug-agent library (src/)
COPY demo/ ./
COPY src/ ./src/

EXPOSE 3000

CMD ["node", "app.js"]
