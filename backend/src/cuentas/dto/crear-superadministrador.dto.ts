import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CrearSuperadministradorDto {

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    nombre!: string;

    @IsOptional()
    @IsString()
    @MaxLength(150)
    apellidos?: string;

    @IsEmail()
    @MaxLength(254)
    correo!: string;
}