# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
# Bun compiles the server into a single binary; CSS is generated at build time
# so the runtime image never needs the Tailwind toolchain.
FROM oven/bun:1.4.4-slim AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build:bin

# ---- runtime --------------------------------------------------------------
FROM debian:testing-slim AS release
LABEL org.opencontainers.image.title="ConvertX"
LABEL org.opencontainers.image.description="Self-hosted file converter with a curated, directional format catalogue"
LABEL org.opencontainers.image.source="https://github.com/C4illin/ConvertX"

WORKDIR /app

# Conversion engines. Keep this list in sync with the registry in
# src/converters/main.ts: every engine there needs its binary installed here.
ENV PIPX_HOME=/opt/pipx
ENV PIPX_BIN_DIR=/usr/local/bin

RUN apt-get update && apt-get install -y --no-install-recommends \
    assimp-utils \
    ca-certificates \
    calibre \
    curl \
    dasel \
    dcraw \
    djvulibre-bin \
    dvisvgm \
    ffmpeg \
    ghostscript \
    gosu \
    graphicsmagick \
    imagemagick-7.q16 \
    inkscape \
    latexmk \
    libheif-examples \
    libjxl-tools \
    libreoffice \
    libva2 \
    libvips-tools \
    libemail-address-perl \
    libemail-outlook-message-perl \
    lmodern \
    mupdf-tools \
    pandoc \
    pipx \
    poppler-utils \
    potrace \
    python3 \
    python3-numpy \
    python3-pip \
    python3-tinycss2 \
    resvg \
    texlive \
    texlive-fonts-recommended \
    texlive-latex-extra \
    texlive-latex-recommended \
    texlive-xetex \
    && pipx install "markitdown[all]" \
    && pipx install pdf2docx \
    && rm -rf /var/lib/apt/lists/*

# MarkItDown pulls an outdated Brotli; upgrade it until the pin is released.
RUN pipx runpip markitdown install --upgrade --no-cache-dir \
    "Brotli>=1.2.1" "brotlicffi>=1.2.1.0"

# VTracer ships release binaries only, so fetch the right architecture.
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ]; then \
        VTRACER_ASSET="vtracer-aarch64-unknown-linux-musl.tar.gz"; \
    else \
        VTRACER_ASSET="vtracer-x86_64-unknown-linux-musl.tar.gz"; \
    fi && \
    curl -fsSL -o /tmp/vtracer.tar.gz \
        "https://github.com/visioncortex/vtracer/releases/download/0.6.4/${VTRACER_ASSET}" && \
    tar -xzf /tmp/vtracer.tar.gz -C /tmp/ && \
    install -m 0755 /tmp/vtracer /usr/local/bin/vtracer && \
    rm -f /tmp/vtracer.tar.gz /tmp/vtracer

# Unprivileged account used by the entrypoint when PUID/PGID are set.
RUN groupadd -g 1000 convertx && \
    useradd -u 1000 -g convertx -d /home/convertx -m -s /bin/bash convertx

COPY --from=build /app/public/ /app/public/
COPY --from=build /app/dist/convertx /app/convertx
COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh && mkdir -p /app/data

EXPOSE 3000

# Calibre's embedded browser cannot sandbox inside containers.
ENV QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox"
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/healthcheck || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/app/convertx"]

# ---- test ----------------------------------------------------------------
# Includes Bun so the route/unit suite can run inside the image, which is the
# only environment with every converter binary installed.
FROM release AS test
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun

FROM release
