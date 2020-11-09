import { CheckProxy } from './../service/check-proxy.service';
import { Component, OnInit } from '@angular/core';
import * as proxyconf from '../../../proxy-conf.json';


@Component({
  selector: 'app-config',
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss']
})
export class ConfigComponent implements OnInit {
  isAlive: boolean;
  checkResult: {};
  proxyconfig: any = (proxyconf as any).default;
  path = Object.getOwnPropertyNames(this.proxyconfig);
  conf: any[] = Array.of(this.proxyconfig);
  newconf = this.conf.shift();
  newnewconf = Object.values(this.newconf);

  constructor(private CheckProxy: CheckProxy) { }

 ngOnInit(): void {
  this.CheckProxy.checkProxy().subscribe(headers => {
    this.checkResult = headers;
    console.log(this.checkResult);
    if (this.checkResult) {
      this.isAlive = true;
    }
  });
  }
}
