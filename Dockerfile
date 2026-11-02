
FROM node:22

WORKDIR /app

# Install Git
RUN apt-get update && apt-get install -y git

# Clone latest GitHub repository
RUN git clone https://github.com/suhel6388/Gym-managment-system.git .

# Move into backend directory
WORKDIR /app/backend

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

EXPOSE 5000

CMD ["npm", "run", "dev"]
