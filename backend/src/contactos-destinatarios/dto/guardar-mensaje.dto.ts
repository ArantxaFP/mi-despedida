import { IsNotEmpty, IsString } from 'class-validator';

export class GuardarMensajeDto {
    @IsString()
    @IsNotEmpty()
    contenido!: string;
}
