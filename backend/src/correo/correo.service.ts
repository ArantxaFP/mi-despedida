import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoClient } from '@getbrevo/brevo';

@Injectable()
export class CorreoService {

    private readonly logger = new Logger(CorreoService.name);
    private readonly brevo: BrevoClient;
    private readonly remitenteEmail: string;
    private readonly remitenteNombre: string;

    constructor(private readonly config: ConfigService) {

        this.brevo = new BrevoClient({
            apiKey: this.config.getOrThrow<string>('BREVO_API_KEY'),
            maxRetries: 0
        });

        this.remitenteEmail =
            this.config.getOrThrow<string>('BREVO_REMITENTE_EMAIL');

        this.remitenteNombre =
            this.config.get<string>('BREVO_REMITENTE_NOMBRE')
            ?? 'Mi despedida';
    }

    // --------------------------------------------------
    // Escapar caracteres especiales para contenido HTML
    // --------------------------------------------------

    private escaparHtml(valor: string): string {
        return valor
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --------------------------------------------------
    // 1. Enviar una invitación para actuar como lanzador
    // --------------------------------------------------

    async enviarInvitacionLanzador(
        correo: string,
        nombre: string,
        enlace: string
    ): Promise<string> {

        const nombreSeguro = this.escaparHtml(nombre);
        const enlaceSeguro = this.escaparHtml(enlace);

        // Versión HTML del correo con botón de acceso.
        // Los estilos se aplican en línea por compatibilidad con los principales clientes de correo.
        const htmlContent = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport"
                      content="width=device-width, initial-scale=1.0">
                <title>Invitación como lanzador - Mi despedida</title>
            </head>

            <body style="
                margin: 0;
                padding: 24px 12px;
                background-color: #f5f7fa;
                font-family: Arial, Helvetica, sans-serif;
                color: #273244;
                font-size: 15px;
                line-height: 1.7;
            ">

                <div style="
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 32px 28px;
                    background-color: #ffffff;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                ">

                    <h1 style="
                        margin: 0 0 24px;
                        color: #071d49;
                        font-size: 24px;
                        font-weight: 700;
                    ">
                        Mi despedida
                    </h1>

                    <p>Hola, ${nombreSeguro}.</p>

                    <p>
                        Has recibido una invitación para actuar
                        como lanzador en Mi despedida.
                    </p>

                    <p>
                        Puedes consultar la invitación
                        pulsando el siguiente botón:
                    </p>

                    <table role="presentation"
                           cellspacing="0"
                           cellpadding="0"
                           border="0"
                           align="center"
                           style="margin: 28px auto;">
                        <tr>
                            <td align="center"
                                bgcolor="#071d49"
                                style="border-radius: 6px;">

                                <a href="${enlaceSeguro}"
                                   target="_blank"
                                   style="
                                       display: inline-block;
                                       padding: 14px 26px;
                                       background-color: #071d49;
                                       color: #ffffff;
                                       font-size: 15px;
                                       font-weight: bold;
                                       line-height: 20px;
                                       text-decoration: none;
                                       border-radius: 6px;
                                   ">
                                    Consultar la invitación
                                </a>

                            </td>
                        </tr>
                    </table>

                    <p>
                        Esta invitación tiene una vigencia de
                        <strong>siete días</strong>.
                        Abrir el enlace no implica aceptarla.
                    </p>

                    <p>
                        Para aceptar o rechazar tendrás que verificar
                        que tienes acceso al correo al que se ha
                        enviado esta invitación.
                    </p>

                    <p>
                        No necesitas registrarte ni crear una
                        cuenta de administrador.
                    </p>

                    <p>
                        Si aceptas, podrás solicitar posteriormente
                        un acceso temporal desde la web de Mi despedida.
                        No necesitarás conservar este correo para ello.
                    </p>

                    <hr style="
                        border: 0;
                        border-top: 1px solid #e5e7eb;
                        margin: 28px 0 20px;
                    ">

                    <p style="
                        margin-bottom: 0;
                        color: #667085;
                        font-size: 13px;
                    ">
                        Si no esperabas este mensaje,
                        puedes ignorarlo.
                    </p>

                </div>

            </body>
            </html>
        `;

        try {
            const resultado =
                await this.brevo.transactionalEmails.sendTransacEmail({
                    sender: {
                        name: this.remitenteNombre,
                        email: this.remitenteEmail
                    },
                    to: [
                        {
                            email: correo,
                            name: nombre
                        }
                    ],
                    subject: 'Mi despedida - Invitación como lanzador',

                    // Versión HTML con botón clicable
                    htmlContent,

                    // Versión alternativa de texto plano
                    textContent:
                        `Hola, ${nombre}.\n\n` +
                        'Has recibido una invitación para actuar como ' +
                        'lanzador en Mi despedida.\n\n' +
                        `Puedes consultar la invitación aquí:\n${enlace}\n\n` +
                        'Esta invitación tiene una vigencia de siete días. ' +
                        'Abrir el enlace no implica aceptarla.\n\n' +
                        'Para aceptar o rechazar tendrás que verificar ' +
                        'que tienes acceso al correo al que se ha enviado ' +
                        'esta invitación.\n\n' +
                        'No necesitas registrarte ni crear una cuenta ' +
                        'de administrador.\n\n' +
                        'Si aceptas, podrás solicitar posteriormente ' +
                        'un acceso temporal desde la web de Mi despedida. ' +
                        'No necesitarás conservar este correo para ello.\n\n' +
                        'Si no esperabas este mensaje, puedes ignorarlo.'
                });

            if (!resultado.messageId) {
                throw new Error(
                    'Brevo no ha devuelto un identificador del mensaje.'
                );
            }

            return resultado.messageId;

        } catch (error) {
            this.logger.error(
                'Error al solicitar el envío de una invitación a Brevo',
                error instanceof Error ? error.message : String(error)
            );

            throw new InternalServerErrorException(
                'No se ha podido solicitar el envío del correo.'
            );
        }
    }

    // --------------------------------------------------
    // 2. Enviar un código de verificación al lanzador
    // --------------------------------------------------

    async enviarCodigoVerificacionLanzador(
        correo: string,
        nombre: string,
        codigo: string
    ): Promise<string> {

        // El código debe tener exactamente ocho dígitos
        if (!/^\d{8}$/.test(codigo)) {
            throw new InternalServerErrorException(
                'No se ha podido preparar el código de verificación.'
            );
        }

        try {
            const resultado =
                await this.brevo.transactionalEmails.sendTransacEmail({
                    sender: {
                        name: this.remitenteNombre,
                        email: this.remitenteEmail
                    },
                    to: [
                        {
                            email: correo,
                            name: nombre
                        }
                    ],
                    subject: 'Mi despedida - Código de verificación',
                    textContent:
                        `Hola, ${nombre}.\n\n` +
                        'Has solicitado verificar tu dirección de correo ' +
                        'para responder a una invitación como lanzador ' +
                        'en Mi despedida.\n\n' +
                        `Tu código de verificación es: ${codigo}\n\n` +
                        'Este código caduca a los 10 minutos.\n\n' +
                        'Introdúcelo en la pantalla donde estás ' +
                        'respondiendo a la invitación.\n\n' +
                        'Verificar tu correo no supone aceptar ' +
                        'automáticamente la invitación. ' +
                        'Después podrás elegir expresamente ' +
                        'si quieres aceptarla o rechazarla.\n\n' +
                        'No compartas este código con nadie.\n\n' +
                        'Si no has solicitado esta verificación, ' +
                        'puedes ignorar el mensaje.'
                });

            if (!resultado.messageId) {
                throw new Error(
                    'Brevo no ha confirmado la solicitud de envío del código.'
                );
            }

            // Solo devolvemos el identificador del mensaje.
            // No devolvemos ni registramos el código.
            return resultado.messageId;

        } catch (error) {
            this.logger.error(
                'Error al solicitar el envío del código de verificación',
                error instanceof Error ? error.message : String(error)
            );

            throw new InternalServerErrorException(
                'No se ha podido solicitar el envío del código de verificación.'
            );
        }
    }
}


