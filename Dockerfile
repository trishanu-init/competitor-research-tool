FROM node:22.14.0

WORKDIR /app

COPY . /app

RUN npm install

EXPOSE 3000

CMD ["node","src/server.js"]
