# RumiCar Simulator — 静的配信コンテナ
FROM nginx:alpine
# gzip 圧縮を有効化した配信設定（stock default.conf を上書き）。
COPY nginx-default.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
EXPOSE 80
