import { Component, OnInit } from '@angular/core';
import { DomainsService } from '../service/domains.service';


@Component({
  selector: 'app-tools',
  templateUrl: './tools.component.html',
  styleUrls: ['./tools.component.scss']
})
export class ToolsComponent implements OnInit {

  Domains

  constructor(private domainsService: DomainsService) { }


  ngOnInit(): void {

    this.domainsService.getDomains().subscribe(body => {

      this.Domains = body;

    });
  }
}
