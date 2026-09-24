export function pipeMarketplaceDownloadStream(stream, response, onUpstreamError) {
  let clientClosed = false;

  function cleanup() {
    response.off("close", onResponseClose);
    response.off("error", onResponseClose);
    response.off("finish", cleanup);
    stream.off("error", onStreamError);
    stream.off("close", onStreamClose);
  }

  function onResponseClose() {
    if (response.writableEnded) {
      cleanup();
      return;
    }
    clientClosed = true;
    response.off("close", onResponseClose);
    response.off("error", onResponseClose);
    response.off("finish", cleanup);
    stream.destroy();
  }

  function onStreamError(error) {
    stream.unpipe(response);
    cleanup();
    if (!clientClosed) onUpstreamError(error);
  }

  function onStreamClose() {
    if (clientClosed) cleanup();
  }

  response.once("close", onResponseClose);
  response.once("error", onResponseClose);
  response.once("finish", cleanup);
  stream.once("error", onStreamError);
  stream.once("close", onStreamClose);
  stream.pipe(response);
}
