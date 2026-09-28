FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 2000 \
  && npm config set fetch-retry-maxtimeout 30000 \
  && npm ci
COPY . ./
ARG VITE_IM_APP_ID=
ENV VITE_IM_APP_ID=$VITE_IM_APP_ID
RUN npm run build:b

FROM nginx:1.27-alpine
ARG IMAGE_NAME
ARG IMAGE_VERSION
ARG IMAGE_REVISION
ARG IMAGE_CREATED
ARG IMAGE_SOURCE
LABEL org.opencontainers.image.title=$IMAGE_NAME \
      org.opencontainers.image.version=$IMAGE_VERSION \
      org.opencontainers.image.revision=$IMAGE_REVISION \
      org.opencontainers.image.created=$IMAGE_CREATED \
      org.opencontainers.image.source=$IMAGE_SOURCE
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY c-end/ /usr/share/nginx/html/
COPY c-end/ /usr/share/nginx/html/a380/
COPY --from=build /app/dist-b/ /usr/share/nginx/html/b/
RUN mv /usr/share/nginx/html/b/index.b.html /usr/share/nginx/html/b/index.html
EXPOSE 80
