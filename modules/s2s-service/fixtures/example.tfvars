service_name               = "loan-origination"
bounded_context            = "lending"
scopes                     = ["lending/write", "lending/read"]
image_uri                  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/dev/loan-origination:latest"
alb_path_pattern           = "/api/loans/*"
alb_listener_rule_priority = 100
outbound_audiences         = []
