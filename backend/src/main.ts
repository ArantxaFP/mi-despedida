import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {

  const app = await NestFactory.create(AppModule);

  // Permitir peticiones desde el backoffice en desarrollo y en prod
  app.enableCors({
    origin: [
      'http://localhost:4200',
      'http://localhost:4201',
      'https://gestion-mi-despedida.netlify.app'
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
