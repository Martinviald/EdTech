// Sin el wrapper de streaming, SST despliega la Function URL de la Lambda en modo
// BUFFERED: la respuesta llega entera al final y el chat del asistente pierde el
// streaming (el SSE de /api/assistant aparece todo de una vez).
const config = {
  default: {
    override: {
      wrapper: 'aws-lambda-streaming',
    },
  },
};

export default config;
