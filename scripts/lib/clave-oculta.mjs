// Lee una contraseña de la terminal SIN mostrarla (modo crudo: cada tecla se recibe sin eco). Solo para terminales (TTY).

export function leerClaveOculta(texto) {
  return new Promise((resolver, rechazar) => {
    const entrada = process.stdin;
    process.stdout.write(texto);
    let clave = '';
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');

    const terminar = () => {
      entrada.setRawMode(false);
      entrada.pause();
      entrada.removeListener('data', alTeclear);
      process.stdout.write('\n');
    };
    const alTeclear = (teclas) => {
      for (const tecla of teclas) {
        if (tecla === '\u0003') {
          // Ctrl+C
          terminar();
          rechazar(new Error('Cancelado.'));
          return;
        }
        if (tecla === '\r' || tecla === '\n') {
          terminar();
          resolver(clave);
          return;
        }
        if (tecla === '\u007f' || tecla === '\b') clave = clave.slice(0, -1);
        else if (tecla >= ' ') clave += tecla;
      }
    };
    entrada.on('data', alTeclear);
  });
}
