import { Routes } from '@angular/router';
import { ConfigComponent } from './config/config.component';
import { HomeComponent } from './home/home.component';
import { ToolsComponent } from './tools/tools.component';
import { CreateDirectoryComponent } from './tools/create-directory/create-directory.component';
import { MainSidenavComponent } from './layouts/main-sidenav/main-sidenav.component';
import { MainComponent } from './layouts/main/main.component';




const appRoutes: Routes = [
    {
      path: '',
      component: MainComponent,
      children: [
        { path: '', component: HomeComponent, pathMatch: 'full' },
      ]
    },
    {
      path: '',
      component: MainSidenavComponent,
      children: [
        { path: 'tools', component: ToolsComponent },
        { path: 'tools/create-directory', component: CreateDirectoryComponent},
        { path: 'config', component: ConfigComponent},
      ]
    },
  ];
export default appRoutes;
