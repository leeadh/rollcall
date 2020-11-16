import { BrowserModule } from '@angular/platform-browser';
import {HttpClientModule} from '@angular/common/http';
import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ClarityModule } from '@clr/angular';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ConfigComponent } from './config/config.component';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import appRoutes from './routerConfig';
import { HomeComponent } from './home/home.component';
import { ToolsComponent } from './tools/tools.component';
import { CommonModule } from '@angular/common';
import { CreateDirectoryComponent } from './tools/create-directory/create-directory.component';
import { MainComponent } from './layouts/main/main.component';
import { MainSidenavComponent } from './layouts/main-sidenav/main-sidenav.component';
import { HeaderComponent } from './layouts/header/header.component';
import { FooterComponent } from './layouts/footer/footer.component';
import { ContentComponent } from './layouts/content/content.component';
import { ContentsidenavComponent } from './layouts/contentsidenav/contentsidenav.component';
import { SidenavComponent } from './layouts/sidenav/sidenav.component';

@NgModule({
  declarations: [
    AppComponent,
    ConfigComponent,
    HomeComponent,
    ToolsComponent,
    CreateDirectoryComponent,
    MainComponent,
    MainSidenavComponent,
    HeaderComponent,
    FooterComponent,
    ContentComponent,
    ContentsidenavComponent,
    SidenavComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    BrowserAnimationsModule,
    ClarityModule,
    FormsModule,
    RouterModule.forRoot(appRoutes),
    HttpClientModule,
    CommonModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
