# Evolution 2.3.7, manifesto linux/amd64 verificado em 15/11/2026.
FROM evoapicloud/evolution-api@sha256:456b4104b0ddffbb092d6b3c0560a4ae86fc3e014e885b882aca4b1b371dfc81
COPY patch-status.cjs verify-patch.cjs /opt/evolution-status-ack/
RUN node /opt/evolution-status-ack/patch-status.cjs /evolution/node_modules/baileys \
    && node --test /opt/evolution-status-ack/verify-patch.cjs
# ENTRYPOINT, CMD, usuário, portas e diretórios herdados da imagem oficial.
