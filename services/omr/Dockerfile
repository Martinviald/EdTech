FROM python:3.12-slim

WORKDIR /srv/omr

# Se instala el LOCK (transitivas incluidas), no requirements.txt: dos builds de esta
# imagen tienen que traer exactamente el mismo OpenCV. requirements.txt se copia sólo
# para que quede junto al lock dentro de la imagen como referencia de qué se pidió.
COPY requirements.txt requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt

COPY contracts/ contracts/
COPY app/ app/

EXPOSE 8090

# OMR_PAGE_TIMEOUT_S no se fija acá: el presupuesto por página del stage se inyecta
# como env var desde sst.config.ts, para poder ajustarlo sin reconstruir la imagen.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
