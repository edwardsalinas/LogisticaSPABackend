/** El resultado que una herramienta `propose_*` le devuelve al modelo: la propuesta (para la tarjeta) y la orden de NO afirmar que ya está hecha. */
export const proposalResult = (proposal, skipped = []) => JSON.stringify({
  kind: 'action_proposal',
  action: proposal,
  skipped, // lo que se pidió pero no se pudo incluir, con el motivo (para decírselo al usuario)
  instruction: 'La acción NO se ha ejecutado. Dile al usuario que revise la tarjeta y pulse Confirmar; no afirmes que ya está hecha.' +
    (skipped.length ? ' Menciona también lo que se omitió y por qué.' : ''),
});
