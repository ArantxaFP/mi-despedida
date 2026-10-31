import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ActualizarDatosCuentaDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    nombre: string;

    @IsOptional()
    @IsString()
    @MaxLength(150)
    apellidos?: string;
}


