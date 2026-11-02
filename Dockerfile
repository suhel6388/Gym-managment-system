FROM node

WORKDIR /app

RUN apt-get update && apt-get install -y git

# Clone latest backend repository
RUN git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git /tmp/repo

WORKDIR /tmp/repo/backend

COPY --from=0 /tmp/repo/backend/package*.json ./

RUN npm install

COPY --from=0 /tmp/repo/backend ./

RUN npx prisma generate

EXPOSE 5000

CMD ["npm", "run", "dev"]