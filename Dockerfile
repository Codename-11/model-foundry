FROM node:24-alpine

# Install dependencies
RUN apk add --no-cache ca-certificates

# Install ModelFoundry globally
RUN npm install -g model-foundry

# Create a directory for the configuration
WORKDIR /app

# Expose the correct local router port
EXPOSE 7352

# Entrypoint: handles commands passed to the container
ENTRYPOINT ["model-foundry"]
CMD ["start"]

