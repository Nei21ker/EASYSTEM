/** Error con código HTTP y un mensaje en español que se muestra tal cual al usuario. */
export class ErrorApi extends Error {
  constructor(
    public status: number,
    mensaje: string,
    public codigo?: string
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}
